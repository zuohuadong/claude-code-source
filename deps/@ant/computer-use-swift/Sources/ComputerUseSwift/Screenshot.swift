// Screenshot.swift - ScreenCaptureKit-based screenshot with app exclusion.
//
// Recovered signatures from binary:
//   static func captureScreenWithExclusion(displayId:width:height:allowedBundleIds:jpegQuality:) async -> (dataUrl:String,width:Int,height:Int)?
//   static func captureScreenRegion(displayId:sourceRect:outputWidth:outputHeight:allowedBundleIds:jpegQuality:) async -> (dataUrl:String,width:Int,height:Int)?
//   static func computeExcludedApps(from:allowedBundleIds:) -> [SCRunningApplication]
//   static let systemChromeBundleIds: Set<String>
//
// Error strings recovered:
//   "ScreenCaptureKit requires macOS 14.0"
//   "Failed to capture with app exclusion: <msg>"
//   "Failed to capture region with app exclusion: <msg>"
//   "Failed to convert screenshot to JPEG"
//   "Failed to convert region screenshot to JPEG"
//   "Screenshot capture returned nil (permission missing or SCContentFilter failure)"
//   "Region capture returned nil (permission missing or SCContentFilter failure)"
//   "Screenshot capture returned no image"

import Foundation
import AppKit
import CoreGraphics
import ScreenCaptureKit

enum ScreenshotForComputerUse {
    /// Errors that can occur during screenshot capture.
    enum ScreenshotError: Error, LocalizedError, Equatable {
        case captureError
        case captureFailedNoImage
        case displayNotFound

        var errorDescription: String? {
            switch self {
            case .captureError:
                return "Failed to capture with app exclusion"
            case .captureFailedNoImage:
                return "Screenshot capture returned no image"
            case .displayNotFound:
                return "Display not found for the given ID"
            }
        }

        var failureReason: String? { nil }
        var recoverySuggestion: String? { nil }
        var helpAnchor: String? { nil }
    }

    /// System chrome apps that are always visible (never excluded).
    /// Recovered as a static Set<String> property in the binary.
    static let systemChromeBundleIds: Set<String> = [
        "com.apple.systemuiserver",
        "com.apple.dock",
        "com.apple.WindowManager",
    ]

    // MARK: - Full-screen capture with exclusion

    /// Capture a full display, excluding apps not in the allowlist.
    ///
    /// Uses SCShareableContent to enumerate windows, builds an
    /// SCContentFilter that excludes non-allowed apps, then captures
    /// via SCStream. The result is JPEG-compressed and base64-encoded.
    ///
    /// - Parameters:
    ///   - displayId: CGDirectDisplayID of the target display
    ///   - width: Desired output width (for downscaling)
    ///   - height: Desired output height
    ///   - allowedBundleIds: Apps that remain visible
    ///   - jpegQuality: JPEG compression quality (0.0-1.0)
    /// - Returns: Tuple of (base64 JPEG data URL, width, height), or nil on failure
    static func captureScreenWithExclusion(
        displayId: UInt32,
        width: Int,
        height: Int,
        allowedBundleIds: [String],
        jpegQuality: CGFloat
    ) async -> (dataUrl: String, width: Int, height: Int)? {
        guard #available(macOS 14.0, *) else {
            NSLog("ScreenCaptureKit requires macOS 14.0")
            return nil
        }

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )

            let excludedApps = computeExcludedApps(
                from: content,
                allowedBundleIds: allowedBundleIds
            )

            // Find the target display
            guard let display = content.displays.first(where: {
                CGDirectDisplayID($0.displayID) == displayId
            }) else {
                NSLog("Display not found for ID: \(displayId)")
                return nil
            }

            let filter = SCContentFilter(
                display: display,
                excludingApplications: excludedApps,
                exceptingWindows: []
            )

            let configuration = SCStreamConfiguration()
            configuration.width = width
            configuration.height = height
            configuration.captureResolution = .best
            configuration.showsCursor = false
            configuration.ignoreShadowsSingleWindow = true

            let image = try await captureImage(filter: filter, configuration: configuration)

            guard !image.isEmpty else {
                NSLog("Screenshot capture returned no image")
                return nil
            }

            guard let jpegData = convertToJPEG(image, quality: jpegQuality) else {
                NSLog("Failed to convert screenshot to JPEG")
                return nil
            }

            let base64 = jpegData.base64EncodedString()
            return (dataUrl: base64, width: width, height: height)
        } catch {
            NSLog("Failed to capture with app exclusion: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Region capture (zoom)

    /// Capture a rectangular region of a display at higher resolution.
    ///
    /// Used by the `zoom` tool to inspect small UI elements.
    ///
    /// - Parameters:
    ///   - displayId: CGDirectDisplayID of the target display
    ///   - sourceRect: Logical coordinate rect to capture
    ///   - outputWidth: Output image width
    ///   - outputHeight: Output image height
    ///   - allowedBundleIds: Apps that remain visible
    ///   - jpegQuality: JPEG compression quality
    static func captureScreenRegion(
        displayId: UInt32,
        sourceRect: CGRect,
        outputWidth: Int,
        outputHeight: Int,
        allowedBundleIds: [String],
        jpegQuality: CGFloat
    ) async -> (dataUrl: String, width: Int, height: Int)? {
        guard #available(macOS 14.0, *) else {
            NSLog("ScreenCaptureKit requires macOS 14.0")
            return nil
        }

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )

            let excludedApps = computeExcludedApps(
                from: content,
                allowedBundleIds: allowedBundleIds
            )

            guard let display = content.displays.first(where: {
                CGDirectDisplayID($0.displayID) == displayId
            }) else {
                NSLog("Display not found for ID: \(displayId)")
                return nil
            }

            let filter = SCContentFilter(
                display: display,
                excludingApplications: excludedApps,
                exceptingWindows: []
            )

            let configuration = SCStreamConfiguration()
            configuration.width = outputWidth
            configuration.height = outputHeight
            // Clip to source rect in display coordinates
            let displayBounds = display.frame
            let normalizedRect = CGRect(
                x: (sourceRect.origin.x - displayBounds.origin.x) / displayBounds.width,
                y: (sourceRect.origin.y - displayBounds.origin.y) / displayBounds.height,
                width: sourceRect.width / displayBounds.width,
                height: sourceRect.height / displayBounds.height
            )
            configuration.sourceRect = normalizedRect
            configuration.captureResolution = .best
            configuration.showsCursor = false

            let image = try await captureImage(filter: filter, configuration: configuration)

            guard !image.isEmpty else {
                NSLog("Region capture returned nil (permission missing or SCContentFilter failure)")
                return nil
            }

            guard let jpegData = convertToJPEG(image, quality: jpegQuality) else {
                NSLog("Failed to convert region screenshot to JPEG")
                return nil
            }

            let base64 = jpegData.base64EncodedString()
            return (dataUrl: base64, width: outputWidth, height: outputHeight)
        } catch {
            NSLog("Failed to capture region with app exclusion: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - App exclusion computation

    /// Determine which running applications should be excluded from the screenshot.
    ///
    /// Excludes all on-screen apps whose bundleId is NOT in the allowlist,
    /// except for system chrome apps (Dock, SystemUIServer, etc).
    static func computeExcludedApps(
        from content: SCShareableContent,
        allowedBundleIds: [String]
    ) -> [SCRunningApplication] {
        let allowed = Set(allowedBundleIds)
        return content.applications.filter { app in
            let bid = app.bundleIdentifier
            // Keep system chrome visible
            if systemChromeBundleIds.contains(bid) {
                return false
            }
            // Exclude if not in allowlist
            return !allowed.contains(bid)
        }
    }

    // MARK: - Private helpers

    /// Capture an image using SCStream (async wrapper).
    @available(macOS 14.0, *)
    private static func captureImage(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration
    ) async throws -> CGImage {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CGImage, Error>) in
            Task.detached {
                do {
                    let image = try await SCScreenshotManager.captureImage(
                        contentFilter: filter,
                        configuration: configuration
                    )
                    continuation.resume(returning: image)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Convert CGImage to JPEG data.
    private static func convertToJPEG(_ image: CGImage, quality: CGFloat) -> Data? {
        let bitmapRep = NSBitmapImageRep(cgImage: image)
        return bitmapRep.representation(
            using: .jpeg,
            properties: [.compressionFactor: quality]
        )
    }
}

// MARK: - CGImage empty check

private extension CGImage {
    var isEmpty: Bool {
        return width <= 0 || height <= 0
    }
}
