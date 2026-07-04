// EscTap.swift - ESC key detection via CGEventTap (abort signal).
//
// Recovered from binary globals:
//   onEscapeTsfn: OpaquePointer? (ThreadSafeFunction for JS callback)
//   runLoopSource: CFRunLoopSource?
//   expectedEscapes: Int
//   escTsfnCallJs: @convention(c) callback
//   escTapCallback(proxy:type:event:userInfo:) -> Unmanaged<CGEvent>?
//
// The ESC tap intercepts ESC key presses to provide an abort mechanism.
// When the model calls notifyExpectedEscape(n), the next n ESC presses
// are intercepted and forwarded to the JS layer via TSFN instead of
// reaching the target application.

import Foundation
import AppKit
import CoreGraphics

// MARK: - Module-level state (matches binary globals)

/// ThreadSafeFunction for calling back to JavaScript when ESC is detected.
/// Set by the NAPI bridge layer during initialization.
var onEscapeTsfn: OpaquePointer?

/// The CGEventTap run loop source.
var runLoopSource: CFRunLoopSource?

/// Number of ESC presses we expect (and should intercept).
/// Set by notifyExpectedEscape(n). Decremented on each intercept.
var expectedEscapes: Int = 0

// MARK: - CGEventTap callback

/// The event tap callback function.
///
/// When expectedEscapes > 0, ESC key-down events are intercepted
/// (returned as nil to suppress delivery) and the JS TSFN is called.
/// When expectedEscapes == 0, events pass through normally.
///
/// Recovered signature:
///   escTapCallback(proxy:type:event:userInfo:) -> Unmanaged<CGEvent>?
let escTapCallback: CGEventTapCallBack = { proxy, type, event, userInfo in
    // Only intercept key-down events
    if type == .keyDown {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        // ESC keycode = 53
        if keyCode == 53 && expectedEscapes > 0 {
            expectedEscapes -= 1
            // Notify JS layer via TSFN
            notifyEscapeDetected()
            // Suppress the event (return nil)
            return nil
        }
    }
    // Pass through
    return Unmanaged.passRetained(event)
}

// MARK: - Setup / teardown

/// Install the ESC key event tap.
///
/// Requires Accessibility permission (same as input simulation).
/// Creates a system-wide event tap at the session level.
func installEscTap() {
    guard runLoopSource == nil else { return }

    let eventMask = (1 << CGEventType.keyDown.rawValue) as CGEventMask

    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: eventMask,
        callback: escTapCallback,
        userInfo: nil
    ) else {
        NSLog("Failed to create ESC event tap (Accessibility permission may be missing)")
        return
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)

    runLoopSource = source
}

/// Remove the ESC key event tap.
func removeEscTap() {
    if let source = runLoopSource {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        runLoopSource = nil
    }
}

/// Set the number of expected ESC presses to intercept.
///
/// Called from the JS layer via the `notifyExpectedEscape` method.
func notifyExpectedEscape(_ count: Int) {
    expectedEscapes = count
    if count > 0 {
        installEscTap()
    }
}

/// Called when an ESC press is intercepted.
///
/// In the NAPI build, this calls the JS ThreadSafeFunction.
/// In standalone Swift, it logs.
private func notifyEscapeDetected() {
    if onEscapeTsfn != nil {
        // NAPI TSFN call would happen here.
        // The native addon's TSFN callback (escTsfnCallJs) receives
        // the count and forwards to the JS handler.
        NSLog("ESC intercepted, notifying JS via TSFN")
    } else {
        NSLog("ESC intercepted (no TSFN registered)")
    }
}

// MARK: - Main run loop pump

/// Pump the macOS main run loop for a short duration.
///
/// This is called by Node.js/Bun consumers via _drainMainRunLoop()
/// because libuv does not drain DispatchQueue.main automatically.
/// Under Electron, CFRunLoop handles this natively.
func drainMainRunLoop() {
    let runLoop = RunLoop.main
    runLoop.run(until: Date(timeIntervalSinceNow: 0.005))
}
