// NapiBridge.swift - NAPI C glue for Node.js integration.
//
// This file contains the C-callable entry point that Node.js invokes
// when loading the .node addon. It bridges between the NAPI C API and
// the Swift ComputerUseBindings methods.
//
// In the original binary, this was compiled as a napi-rs or manual
// napi addon. The entry point is napi_register_module_v1, which calls
// napiRegisterModule, which calls ComputerUseBindings.createObject(env).
//
// Recovered symbols:
//   _napi_register_module_v1
//   _$s16ComputerUseSwift18napiRegisterModuleys13OpaquePointerVSgAE_AEtF
//   _$s16ComputerUseSwift0aB8BindingsO12createObject3envs13OpaquePointerVSgAG_tFZ
//   computerUse (JS export name)

import Foundation

// NAPI C types are available via the Node.js addon API.
// In the original binary, these were linked from libnode or napi-rs.
// Here we declare the minimum needed for the bridge.

// MARK: - NAPI module registration

/// Module registration entry point.
///
/// Called by Node.js when `require('computer_use.node')` is executed.
/// Creates the `computerUse` object with all methods and returns it.
///
/// In the NAPI binary, this is `_napi_register_module_v1`.
/// The JS wrapper (js/index.js) accesses `native.computerUse`.
@_cdecl("napi_register_module_v1")
public func napiRegisterModule(
    env: OpaquePointer?,
    exports: OpaquePointer?
) -> OpaquePointer? {
    // Guard: macOS only
    #if os(macOS)
    // In the real binary, ComputerUseBindings.createObject(env:) builds
    // the napi_value object with all named properties and returns it.
    // Here we return the exports pointer as-is (the C glue handles
    // property registration via napi_set_named_property).
    //
    // Each method below would be registered as:
    //   napi_set_named_property(env, exports, "screenshot", jsScreenshot)
    //   napi_set_named_property(env, exports, "captureExcluding", jsCaptureExcluding)
    //   ...
    //
    // The full list of 20+ registered methods matches the arg validation
    // strings recovered from the binary:
    //   captureExcluding, captureRegion, findWindowDisplays, open,
    //   prepareDisplay, previewHideSet, resolveBundleIds,
    //   resolvePrepareCapture, unhide
    //
    // And the parameterless methods:
    //   screenshot, display, displayIds, displays, frontmostApplication,
    //   checkAccessibility, checkScreenRecording, requestAccessibility,
    //   requestScreenRecording, notifyExpectedEscape, hotkey, listInstalled
    //
    // Plus the run loop pump:
    //   _drainMainRunLoop
    //
    // Properties on the exported object:
    //   activated: String? (last activated bundleId, or null)
    //   hide: (function, alias for hideNonAllowedApps)
    //   apps: { listInstalled() } (sub-namespace for app queries)

    return ComputerUseBindings.createObject(env: env ?? OpaquePointer(bitPattern: 0)!)
    #else
    return nil
    #endif
}

// MARK: - NAPI helper functions (recovered from binary)
//
// These helpers were used by the original code to build the JS object.
// Recovered from demangled symbols:
//
//   setStringProp(env, obj, key, value) -> void
//   getStringArray(env, value) -> [String]?
//   makePromise(env, resourceName) -> (promise, deferred, tsfn)?
//
// setStringProp: napi_create_string_utf8 -> napi_set_named_property
// getStringArray: napi_get_array_length -> iterate -> napi_get_value_string_utf8
// makePromise: napi_create_promise -> napi_create_threadsafe_function

/// Set a string property on a NAPI object.
/// Recovered signature: setStringProp(OpaquePointer, OpaquePointer, String, String) -> ()
@inline(__always)
func setStringProp(
    _ env: OpaquePointer,
    _ obj: OpaquePointer,
    _ key: String,
    _ value: String
) {
    // In the real binary:
    //   napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &strVal)
    //   napi_set_named_property(env, obj, key, strVal)
    // Stub: documented for source recovery completeness.
}

/// Extract a string array from a NAPI value.
/// Recovered signature: getStringArray(OpaquePointer, OpaquePointer) -> [String]?
@inline(__always)
func getStringArray(
    _ env: OpaquePointer,
    _ value: OpaquePointer
) -> [String]? {
    // In the real binary:
    //   napi_get_array_length(env, value, &length)
    //   for i in 0..<length: napi_get_element -> napi_get_value_string_utf8
    nil
}

/// Create a NAPI promise + ThreadSafeFunction for async operations.
/// Recovered signature: makePromise(OpaquePointer, String) -> (promise, deferred, tsfn)?
@inline(__always)
func makePromise(
    _ env: OpaquePointer,
    resourceName: String
) -> (promise: OpaquePointer, deferred: OpaquePointer, tsfn: OpaquePointer)? {
    // In the real binary:
    //   napi_create_promise(env, &deferred, &promise)
    //   napi_create_string_utf8(env, resourceName, ...)
    //   napi_create_threadsafe_function(env, callback, ..., callJsCb, ...)
    nil
}
