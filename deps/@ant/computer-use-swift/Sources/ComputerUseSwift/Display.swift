// Display.swift - Display enumeration and geometry helpers.
//
// Recovered from binary:
//   func cuDisplayInfo(forDisplayID:) -> CUDisplayInfo?
//   func findWindowDisplays(bundleIds:) -> [(bundleId, displayIds)]
//   func notifyExpectedEscape()
//   func hotkey()
//   func unhide(bundleIds:)
//   func open(bundleId:)
//   func previewHideSet(exemptBundleIds:)
//   func hide / activated / display / displayIds / displays

import Foundation
import AppKit
import CoreGraphics

// MARK: - Display geometry

/// Get display geometry for a specific display (or primary if nil).
///
/// Signature recovered: cuDisplayInfo(forDisplayID: UInt32?) -> CUDisplayInfo?
func cuDisplayInfo(forDisplayID displayId: UInt32?) -> CUDisplayInfo? {
    let screen: NSScreen?
    if let displayId {
        screen = findScreen(for: displayId)
    } else {
        screen = NSScreen.main
    }

    guard let screen else { return nil }

    let frame = screen.frame
    let scaleFactor = screen.backingScaleFactor

    // Get CGDirectDisplayID from NSScreen
    let displayID: UInt32
    if let did = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
        displayID = did.uint32Value
    } else if let displayId {
        displayID = displayId
    } else {
        displayID = CGMainDisplayID()
    }

    return CUDisplayInfo(
        displayId: displayID,
        width: frame.width,
        height: frame.height,
        originX: frame.origin.x,
        originY: frame.origin.y,
        scaleFactor: scaleFactor,
        isPrimary: displayID == CGMainDisplayID()
    )
}

/// Find the NSScreen corresponding to a CGDirectDisplayID.
///
/// Recovered as an inner function (findScreen #1).
func findScreen(for displayId: UInt32) -> NSScreen? {
    for screen in NSScreen.screens {
        if let did = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
           did.uint32Value == displayId {
            return screen
        }
    }
    return nil
}

// MARK: - Window / display mapping

/// Find which displays contain windows for the given bundle IDs.
///
/// Returns an array of (bundleId, [displayIds]) pairs.
/// Uses CGWindowListCopyWindowInfo to enumerate on-screen windows.
func findWindowDisplays(bundleIds: [String]) -> [(bundleId: String, displayIds: [UInt32])] {
    let targetSet = Set(bundleIds)
    var result: [(String, [UInt32])] = []

    let windowInfoOptions: CGWindowListOption = [
        .optionOnScreenOnly,
        .excludeDesktopElements,
    ]

    guard let windowList = CGWindowListCopyWindowInfo(windowInfoOptions, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    // Build a mapping from display bounds for hit-testing
    let displays = NSScreen.screens
    var displayBounds: [(id: UInt32, frame: CGRect)] = []
    for screen in displays {
        if let did = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            displayBounds.append((did.uint32Value, screen.frame))
        }
    }

    var bundleDisplayMap: [String: Set<UInt32>] = [:]

    for window in windowList {
        guard let ownerBundleId = window[kCGWindowOwnerName as String] as? String else { continue }
        guard targetSet.contains(ownerBundleId) else { continue }

        guard let boundsDict = window[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else {
            continue
        }

        // Find which displays this window intersects
        for (displayId, displayFrame) in displayBounds {
            if bounds.intersects(displayFrame) {
                bundleDisplayMap[ownerBundleId, default: []].insert(displayId)
            }
        }
    }

    for bundleId in bundleIds {
        if let displayIds = bundleDisplayMap[bundleId] {
            result.append((bundleId, Array(displayIds)))
        } else {
            result.append((bundleId, []))
        }
    }

    return result
}

// MARK: - Window management

/// Hide all non-allowlisted apps, returning their bundle IDs.
///
/// Uses NSWorkspace.runningApplications to find visible apps,
/// then calls hide() on each one not in the allowlist.
func hideNonAllowedApps(allowlistBundleIds: [String], exemptBundleIds: [String]) -> [String] {
    let allowSet = Set(allowlistBundleIds)
    let exemptSet = Set(exemptBundleIds)
    var hidden: [String] = []

    let workspace = NSWorkspace.shared
    let runningApps = workspace.runningApplications

    for app in runningApps {
        let bundleId = app.bundleIdentifier ?? ""
        if bundleId.isEmpty { continue }

        // Skip allowlisted apps
        if allowSet.contains(bundleId) { continue }
        // Skip exempt apps (Finder, system chrome)
        if exemptSet.contains(bundleId) { continue }

        // Only hide apps with UI (activationPolicy != .prohibited)
        if app.activationPolicy == .regular || app.activationPolicy == .accessory {
            app.hide()
            hidden.append(bundleId)
        }
    }

    return hidden
}

/// Unhide previously hidden apps.
func unhide(bundleIds: [String]) {
    let workspace = NSWorkspace.shared
    let runningApps = workspace.runningApplications

    for app in runningApps {
        guard let bundleId = app.bundleIdentifier else { continue }
        if bundleIds.contains(bundleId) {
            app.unhide()
        }
    }
}

/// Activate an app by bundle ID (bring to front).
func activate(bundleId: String) -> Bool {
    let workspace = NSWorkspace.shared
    let runningApps = workspace.runningApplications

    for app in runningApps {
        if app.bundleIdentifier == bundleId {
            app.activate(options: [.activateAllWindows])
            return true
        }
    }

    // Not running — launch it
    if let url = workspace.urlForApplication(withBundleIdentifier: bundleId) {
        workspace.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        return true
    }

    NSLog("No application found for bundle ID %@", bundleId)
    return false
}

/// Preview which apps would be hidden (without actually hiding them).
func previewHideSet(exemptBundleIds: [String], allowlistBundleIds: [String]) -> [(bundleId: String, displayName: String)] {
    let allowSet = Set(allowlistBundleIds)
    let exemptSet = Set(exemptBundleIds)
    var result: [(String, String)] = []

    let workspace = NSWorkspace.shared
    let runningApps = workspace.runningApplications

    for app in runningApps {
        guard let bundleId = app.bundleIdentifier else { continue }
        if allowSet.contains(bundleId) { continue }
        if exemptSet.contains(bundleId) { continue }
        if app.activationPolicy != .regular && app.activationPolicy != .accessory { continue }

        let displayName = app.localizedName ?? bundleId
        result.append((bundleId, displayName))
    }

    return result
}

// MARK: - Running apps

func listRunningApps() -> [RunningApp] {
    let workspace = NSWorkspace.shared
    return workspace.runningApplications.compactMap { app in
        guard let bundleId = app.bundleIdentifier else { return nil }
        return RunningApp(
            bundleId: bundleId,
            displayName: app.localizedName ?? bundleId,
            pid: app.processIdentifier
        )
    }
}

// MARK: - Frontmost app

func frontmostApplication() -> (bundleId: String, displayName: String)? {
    guard let app = NSWorkspace.shared.frontmostApplication,
          let bundleId = app.bundleIdentifier else {
        return nil
    }
    let displayName = app.localizedName ?? bundleId
    return (bundleId, displayName)
}

// MARK: - Display enumeration

func listDisplays() -> [CUDisplayInfo] {
    NSScreen.screens.compactMap { screen in
        guard let did = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }
        return CUDisplayInfo(
            displayId: did.uint32Value,
            width: screen.frame.width,
            height: screen.frame.height,
            originX: screen.frame.origin.x,
            originY: screen.frame.origin.y,
            scaleFactor: screen.backingScaleFactor,
            isPrimary: did.uint32Value == CGMainDisplayID()
        )
    }
}
