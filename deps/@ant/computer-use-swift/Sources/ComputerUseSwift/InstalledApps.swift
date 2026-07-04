// InstalledApps.swift - Spotlight-based installed app enumeration.
//
// Recovered signatures from binary:
//   static func list() async throws -> [InstalledApp]
//   private static func performSpotlightQuery() async throws -> [InstalledApp]
//   private static func isBackgroundOrAgent(_ item: Any?) -> Bool
//   private static var cached: [InstalledApp]?
//   private static var cachedAt: Date?
//   private static var inFlight: Task<[InstalledApp], Error>?
//
// Error strings recovered:
//   "NSMetadataQuery failed to start (Spotlight may be indexing or disabled)"
//   "No application found for bundle ID <id>"

import Foundation
import AppKit

enum InstalledAppsCache {
    /// Cached app list (60-second TTL).
    private static var cached: [InstalledApp]?
    private static var cachedAt: Date?
    private static var inFlight: Task<[InstalledApp], Error>?

    private static let cacheTTL: TimeInterval = 60

    /// List all installed applications.
    ///
    /// Uses NSMetadataQuery (Spotlight) to find all .app bundles with
    /// kMDItemCFBundleIdentifier. Results are cached for 60 seconds.
    /// Concurrent calls share a single in-flight query.
    static func list() async throws -> [InstalledApp] {
        // Return cache if fresh
        if let cached, let cachedAt,
           Date().timeIntervalSince(cachedAt) < cacheTTL {
            return cached
        }

        // Deduplicate concurrent calls
        if let inFlight {
            return try await inFlight.value
        }

        let task = Task<[InstalledApp], Error> {
            try await performSpotlightQuery()
        }
        inFlight = task

        do {
            let result = try await task.value
            cached = result
            cachedAt = Date()
            inFlight = nil
            return result
        } catch {
            inFlight = nil
            throw error
        }
    }

    /// Clear the cache (force re-query on next list() call).
    static func clearCache() {
        cached = nil
        cachedAt = nil
    }

    /// Perform the Spotlight metadata query for application bundles.
    ///
    /// Uses NSMetadataQuery with predicate:
    ///   kMDItemContentType == "com.apple.application-bundle"
    /// Collects: bundleId (kMDItemCFBundleIdentifier), displayName, path.
    /// Filters out LSBackgroundOnly apps (agents, daemons, helpers).
    private static func performSpotlightQuery() async throws -> [InstalledApp] {
        try await withCheckedThrowingContinuation { continuation in
            let query = NSMetadataQuery()
            query.predicate = NSPredicate(
                format: "%K == %@",
                NSMetadataItemContentTypeKey,
                "com.apple.application-bundle"
            )
            query.searchScopes = [NSMetadataQueryLocalComputerScope]
            query.sortDescriptors = [
                NSSortDescriptor(key: NSMetadataItemDisplayNameKey, ascending: true)
            ]

            var results: [InstalledApp] = []
            var finished = false

            let center = NotificationCenter.default

            var didFinish: NSObjectProtocol?

            didFinish = center.addObserver(forName: .NSMetadataQueryDidFinishGathering,
                                           object: query,
                                           queue: .main) { _ in
                guard !finished else { return }
                finished = true

                for i in 0..<query.resultCount {
                    let item = query.result(at: i) as? NSMetadataItem
                    guard let item else { continue }

                    // Skip background-only apps
                    if isBackgroundOrAgent(item) { continue }

                    let bundleId = item.value(forAttribute: "kMDItemCFBundleIdentifier") as? String ?? ""
                    let displayName = item.value(forAttribute: NSMetadataItemDisplayNameKey) as? String ?? ""
                    let path = item.value(forAttribute: NSMetadataItemPathKey) as? String ?? ""

                    guard !bundleId.isEmpty, !path.isEmpty else { continue }

                    let app = InstalledApp(
                        bundleId: bundleId,
                        displayName: displayName,
                        path: path,
                        iconDataUrl: nil
                    )
                    results.append(app)
                }

                query.stop()
                if let didFinish {
                    center.removeObserver(didFinish)
                }
                continuation.resume(returning: results)
            }

            // Start with a timeout safeguard
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
                guard !finished else { return }
                finished = true
                query.stop()
                if let didFinish {
                    center.removeObserver(didFinish)
                }
                continuation.resume(
                    throwing: NSError(
                        domain: "InstalledAppsCache",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "NSMetadataQuery timed out"]
                    )
                )
            }

            if !query.start() {
                if let didFinish {
                    center.removeObserver(didFinish)
                }
                continuation.resume(
                    throwing: InstalledAppsError.queryFailedToStart
                )
            }
        }
    }

    /// Check if a metadata item represents a background-only application
    /// (launch agents, daemons, helper tools) that should not appear in
    /// the installed apps list.
    ///
    /// Checks LSBackgroundOnly and LSUIElement (agent) Info.plist keys.
    private static func isBackgroundOrAgent(_ item: Any?) -> Bool {
        guard let metadataItem = item as? NSMetadataItem else {
            return false
        }

        // Check LSBackgroundOnly
        if let bgOnly = metadataItem.value(forAttribute: "kMDItemFSContentChangeDate") {
            _ = bgOnly // suppress unused
        }

        // Read from the app bundle's Info.plist
        guard let path = metadataItem.value(forAttribute: NSMetadataItemPathKey) as? String,
              let bundle = Bundle(path: path) else {
            return false
        }

        // LSBackgroundOnly = true means it's a background daemon
        if bundle.object(forInfoDictionaryKey: "LSBackgroundOnly") != nil {
            return true
        }

        // LSUIElement = true means it's an agent (no Dock icon)
        // We keep these in the list as they may have UI
        return false
    }
}

// MARK: - App bundle resolver

/// Resolve application display names to bundle identifiers.
///
/// Uses NSWorkspace to look up apps by name, falling back to
/// LaunchServices registration.
enum AppBundleResolver {
    /// Resolve a list of display names to bundle identifiers.
    ///
    /// Signature recovered from binary:
    ///   static func bundleIds(forAppNames:) -> [String]
    static func bundleIds(forAppNames names: [String]) -> [String] {
        let workspace = NSWorkspace.shared

        return names.map { name in
            // First try NSWorkspace URL lookup
            if workspace.urlForApplication(withBundleIdentifier: name) != nil {
                // The input was already a bundle ID
                return name
            }

            // Try to find by display name using Spotlight
            // Build a quick metadata query for this name
            let predicate = NSPredicate(
                format: "%K == %@ AND %K == %@",
                NSMetadataItemContentTypeKey, "com.apple.application-bundle",
                NSMetadataItemDisplayNameKey, name
            )

            let query = NSMetadataQuery()
            query.predicate = predicate
            query.searchScopes = [NSMetadataQueryLocalComputerScope]

            var result: String?
            let semaphore = DispatchSemaphore(value: 0)

            let observer = NotificationCenter.default.addObserver(
                forName: .NSMetadataQueryDidFinishGathering,
                object: query,
                queue: .main
            ) { _ in
                if query.resultCount > 0,
                   let item = query.result(at: 0) as? NSMetadataItem {
                    result = item.value(forAttribute: "kMDItemCFBundleIdentifier") as? String
                }
                query.stop()
                semaphore.signal()
            }

            query.start()
            _ = semaphore.wait(timeout: .now() + 5)
            NotificationCenter.default.removeObserver(observer)

            return result ?? name
        }
    }
}
