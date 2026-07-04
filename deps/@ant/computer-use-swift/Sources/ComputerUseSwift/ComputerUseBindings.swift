// ComputerUseBindings.swift - NAPI bridge and main entry point.
//
// This file implements the ComputerUseBindings enum that serves as the
// NAPI bridge between Node.js and the Swift native code. It creates the
// exported `computerUse` object with all methods.
//
// Recovered from binary:
//   static func createObject(env: OpaquePointer) -> OpaquePointer?
//   napi_register_module_v1 -> napiRegisterModule -> createObject
//   module.exports = native.computerUse
//
// Exported JS methods (from binary string table + arg validation strings):
//   screenshot(opts)                    captureExcluding(opts)
//   captureRegion(opts)                  listInstalled()
//   prepareDisplay(opts)                 resolvePrepareCapture(opts)
//   display(opts)                        displayIds()
//   displays()                           findWindowDisplays(opts)
//   frontmostApplication()               resolveBundleIds(opts)
//   checkAccessibility()                 checkScreenRecording()
//   requestAccessibility()               requestScreenRecording()
//   notifyExpectedEscape(count)          hotkey()
//   unhide(bundleIds)                    open(bundleId)
//   previewHideSet(exemptBundleIds)     _drainMainRunLoop()
//   activated (property)                 hide (property)

import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

// MARK: - Promise bridge

/// Internal NAPI promise bridge data.
///
/// Recovered from binary class name: ChicagoPromiseData
/// Stores: napi_deferred, napi_threadsafe_function, napi_value (promise)
fileprivate class ChicagoPromiseData {
    var promise: OpaquePointer?
    var deferred: OpaquePointer?
    var tsfn: OpaquePointer?
}

// MARK: - Main bindings enum

enum ComputerUseBindings {
    // MARK: - NAPI module entry

    /// Create the exported JS object.
    ///
    /// In the actual NAPI binary, this calls napi_create_object and
    /// attaches all methods via napi_set_named_property. Here we document
    /// the full method surface and provide the Swift implementations.
    ///
    /// Each method corresponds to a named property on the returned object.
    static func createObject(env: OpaquePointer) -> OpaquePointer? {
        // The NAPI runtime calls this via napi_register_module_v1.
        // In pure Swift (non-NAPI), this returns nil.
        // In the NAPI addon, the C glue code creates the object and
        // registers each method below as a napi_callback.
        nil
    }

    // MARK: - Screenshot methods

    /// Take a full-screen screenshot excluding non-allowed apps.
    ///
    /// JS signature: screenshot({ allowedBundleIds: string[], displayId?: number })
    /// Returns: ScreenshotResult { base64, width, height, displayWidth, displayHeight, originX, originY, displayId }
    static func screenshot(
        allowedBundleIds: [String],
        displayId: UInt32? = nil
    ) async -> ScreenshotResult? {
        let did = displayId ?? CGMainDisplayID()
        guard let display = cuDisplayInfo(forDisplayID: did) else {
            NSLog("CU display unavailable")
            return nil
        }

        let targetWidth = Int(display.width)
        let targetHeight = Int(display.height)

        guard let result = await ScreenshotForComputerUse.captureScreenWithExclusion(
            displayId: did,
            width: targetWidth,
            height: targetHeight,
            allowedBundleIds: allowedBundleIds,
            jpegQuality: 0.8
        ) else {
            return nil
        }

        return ScreenshotResult(
            base64: result.dataUrl,
            width: result.width,
            height: result.height,
            displayWidth: Int(display.width),
            displayHeight: Int(display.height),
            originX: Int(display.originX),
            originY: Int(display.originY),
            displayId: did
        )
    }

    /// Capture with explicit exclusion (chicagoCaptureExcluding alias).
    ///
    /// JS signature: captureExcluding({ allowedBundleIds: string[], displayId?: number })
    static func captureExcluding(
        allowedBundleIds: [String],
        displayId: UInt32? = nil
    ) async -> ScreenshotResult? {
        await screenshot(allowedBundleIds: allowedBundleIds, displayId: displayId)
    }

    /// Capture a region (zoom).
    ///
    /// JS signature: captureRegion({ allowedBundleIds, regionX, regionY, regionW, regionH, outputWidth, outputHeight })
    static func captureRegion(
        allowedBundleIds: [String],
        regionX: CGFloat,
        regionY: CGFloat,
        regionW: CGFloat,
        regionH: CGFloat,
        outputWidth: Int,
        outputHeight: Int,
        displayId: UInt32? = nil
    ) async -> ZoomResult? {
        let did = displayId ?? CGMainDisplayID()
        let sourceRect = CGRect(x: regionX, y: regionY, width: regionW, height: regionH)

        guard let result = await ScreenshotForComputerUse.captureScreenRegion(
            displayId: did,
            sourceRect: sourceRect,
            outputWidth: outputWidth,
            outputHeight: outputHeight,
            allowedBundleIds: allowedBundleIds,
            jpegQuality: 0.9
        ) else {
            return nil
        }

        return ZoomResult(
            base64: result.dataUrl,
            width: result.width,
            height: result.height
        )
    }

    // MARK: - Prepare / capture atomic

    /// Prepare display: hide non-allowed apps and optionally activate one.
    ///
    /// JS signature: prepareDisplay({ allowedBundleIds: string[], hostBundleId: string })
    /// Returns: { hidden: string[], activated: string|null }
    static func prepareDisplay(
        allowedBundleIds: [String],
        hostBundleId: String
    ) -> PrepareDisplayResult {
        let exempt = exemptBundleIds(hostBundleId: hostBundleId)
        let hidden = _hideNonAllowedApps(
            allowlistBundleIds: allowedBundleIds,
            exemptBundleIds: exempt
        )
        return PrepareDisplayResult(hidden: hidden, activated: nil)
    }

    /// Atomic: prepare display + capture screenshot.
    ///
    /// JS signature: resolvePrepareCapture({ allowedBundleIds: string[], hostBundleId: string })
    static func resolvePrepareCapture(
        allowedBundleIds: [String],
        hostBundleId: String,
        preferredDisplayId: UInt32? = nil
    ) async -> ResolvePrepareCaptureResult? {
        let exempt = exemptBundleIds(hostBundleId: hostBundleId)
        let hidden = _hideNonAllowedApps(
            allowlistBundleIds: allowedBundleIds,
            exemptBundleIds: exempt
        )

        // Determine best display
        let did = preferredDisplayId ?? bestDisplayForAllowedApps(allowedBundleIds)

        guard let display = cuDisplayInfo(forDisplayID: did) else {
            NSLog("CU display unavailable")
            return nil
        }

        guard let shot = await ScreenshotForComputerUse.captureScreenWithExclusion(
            displayId: did,
            width: Int(display.width),
            height: Int(display.height),
            allowedBundleIds: allowedBundleIds,
            jpegQuality: 0.8
        ) else {
            return nil
        }

        return ResolvePrepareCaptureResult(
            base64: shot.dataUrl,
            width: shot.width,
            height: shot.height,
            displayWidth: Int(display.width),
            displayHeight: Int(display.height),
            originX: Int(display.originX),
            originY: Int(display.originY),
            displayId: did,
            hidden: hidden,
            activated: nil
        )
    }

    // MARK: - Display methods

    /// Get info for a specific display.
    ///
    /// JS signature: display({ displayId: number })
    static func display(displayId: UInt32?) -> CUDisplayInfo? {
        cuDisplayInfo(forDisplayID: displayId)
    }

    /// Get all display IDs.
    ///
    /// JS signature: displayIds()
    static func displayIds() -> [UInt32] {
        _listDisplays().map { $0.displayId }
    }

    /// Get all displays with full geometry.
    ///
    /// JS signature: displays()
    static func displays() -> [CUDisplayInfo] {
        _listDisplays()
    }

    // MARK: - Window methods

    /// Find which displays contain windows for given apps.
    ///
    /// JS signature: findWindowDisplays({ bundleIds: string[] })
    static func findWindowDisplays(bundleIds: [String]) -> [(bundleId: String, displayIds: [UInt32])] {
        _findWindowDisplays(bundleIds: bundleIds)
    }

    /// Get the frontmost application.
    ///
    /// JS signature: frontmostApplication()
    static func frontmostApplication() -> (bundleId: String, displayName: String)? {
        _frontmostApplication()
    }

    // MARK: - App resolution

    /// Resolve display names to bundle IDs.
    ///
    /// JS signature: resolveBundleIds({ names: string[] })
    static func resolveBundleIds(names: [String]) -> [String] {
        AppBundleResolver.bundleIds(forAppNames: names)
    }

    /// List installed applications.
    ///
    /// JS signature: listInstalled()
    static func listInstalled() async throws -> [InstalledApp] {
        try await InstalledAppsCache.list()
    }

    // MARK: - Permission checks

    /// Check if Accessibility permission is granted.
    ///
    /// JS signature: checkAccessibility()
    static func checkAccessibility() -> Bool {
        AXIsProcessTrustedWithOptions(nil)
    }

    /// Check if Screen Recording permission is granted.
    ///
    /// JS signature: checkScreenRecording()
    static func checkScreenRecording() -> Bool {
        // CGPreflightScreenCaptureAccess returns true if granted
        if #available(macOS 15.0, *) {
            return CGPreflightScreenCaptureAccess()
        } else {
            // Pre-15.0: check by attempting to capture
            return preflightScreenRecording()
        }
    }

    /// Request Accessibility permission (opens System Settings).
    ///
    /// JS signature: requestAccessibility()
    static func requestAccessibility() {
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true]
        _ = AXIsProcessTrustedWithOptions(options)
    }

    /// Request Screen Recording permission.
    ///
    /// JS signature: requestScreenRecording()
    static func requestScreenRecording() {
        if #available(macOS 15.0, *) {
            CGRequestScreenCaptureAccess()
        } else {
            // Pre-15: open System Settings
            openScreenRecordingSettings()
        }
    }

    // MARK: - ESC abort

    /// Set expected ESC count for abort interception.
    ///
    /// JS signature: notifyExpectedEscape(count)
    static func notifyExpectedEscape(_ count: Int) {
        _setExpectedEscapes(count)
    }

    // MARK: - App management

    /// Unhide previously hidden apps.
    ///
    /// JS signature: unhide({ bundleIds: string[] })
    static func unhide(bundleIds: [String]) {
        _unhideApps(bundleIds: bundleIds)
    }

    /// Open / activate an app.
    ///
    /// JS signature: open({ bundleId: string })
    static func open(bundleId: String) {
        _ = _activateApp(bundleId: bundleId)
    }

    /// Preview which apps would be hidden.
    ///
    /// JS signature: previewHideSet({ exemptBundleIds: string[] })
    static func previewHideSet(exemptBundleIds: [String]) -> [(bundleId: String, displayName: String)] {
        _previewHideSet(exemptBundleIds: exemptBundleIds, allowlistBundleIds: [])
    }

    // MARK: - Run loop pump

    /// Drain the main run loop (for libuv consumers).
    ///
    /// JS signature: _drainMainRunLoop()
    static func drainMainRunLoop() {
        _drainMainRunLoopImpl()
    }

    // MARK: - Private helpers

    /// Exempt bundle IDs that should never be hidden.
    /// Includes: Finder (hiding it kills the Desktop), host app, system chrome.
    private static func exemptBundleIds(hostBundleId: String) -> [String] {
        var exempt = ScreenshotForComputerUse.systemChromeBundleIds.map { $0 }
        exempt.append("com.apple.finder")
        exempt.append(hostBundleId)
        return exempt
    }

    /// Find the display that contains the most allowed-app windows.
    private static func bestDisplayForAllowedApps(_ allowedBundleIds: [String]) -> UInt32 {
        let mapping = _findWindowDisplays(bundleIds: allowedBundleIds)
        var displayCount: [UInt32: Int] = [:]

        for (_, displayIds) in mapping {
            for did in displayIds {
                displayCount[did, default: 0] += 1
            }
        }

        // Pick display with most allowed windows, fallback to main
        if let best = displayCount.max(by: { $0.value < $1.value }) {
            return best.key
        }
        return CGMainDisplayID()
    }

    /// Pre-macOS 15 screen recording check.
    private static func preflightScreenRecording() -> Bool {
        // Attempt a trivial screen capture
        let displayID = CGMainDisplayID()
        let image = CGDisplayCreateImage(displayID)
        return image != nil
    }

    /// Open System Settings > Privacy > Screen Recording.
    private static func openScreenRecordingSettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        if let url {
            NSWorkspace.shared.open(url)
        }
    }
}
