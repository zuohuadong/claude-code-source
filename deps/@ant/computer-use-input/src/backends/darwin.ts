/**
 * macOS (darwin) backend for @ant/computer-use-input.
 *
 * Delegates to the native computer-use-input.node addon, which is a
 * Rust NAPI-RS module using enigo for keyboard/mouse simulation.
 * All operations are dispatched to DispatchQueue.main by the native code.
 *
 * Under Node/Bun (libuv), the caller must pump CFRunLoop via
 * @ant/computer-use-swift's _drainMainRunLoop while key()/keys() are pending.
 */

import type { InputBackend, FrontmostAppInfo } from '../types.js'

// Load the native addon via the existing JS wrapper.
// The wrapper handles COMPUTER_USE_INPUT_NODE_PATH and platform detection.
const native = require('../js/index.js')

export const moveMouse: InputBackend['moveMouse'] = async (x, y, animated) => {
  await native.moveMouse(x, y, animated ?? false)
}

export const key: InputBackend['key'] = async (keyName, action) => {
  // The native addon's key() function handles press/release/click internally.
  // action parameter maps to the enigo action.
  if (action === 'release') {
    // For release, we need to call with a release flag.
    // The native API uses key(name) for click; for press/release we
    // would extend the API. For now, click covers the common case.
    await native.key(keyName)
  } else {
    await native.key(keyName)
  }
}

export const keys: InputBackend['keys'] = async (parts) => {
  const chord = parts.join('+')
  await native.keys(chord)
}

export const mouseLocation: InputBackend['mouseLocation'] = async () => {
  return await native.mouseLocation()
}

export const mouseButton: InputBackend['mouseButton'] = async (button, action, count) => {
  // Map InputBackend API to native mouseButton(button, action, count).
  // Native button names: left, right, middle, scrollUp, scrollDown,
  //   scrollLeft, scrollRight
  await native.mouseButton(button, action, count ?? 1)
}

export const mouseScroll: InputBackend['mouseScroll'] = async (amount, direction) => {
  // Native mouseScroll(amount, direction) where direction is
  // "vertical" or "horizontal".
  const dir = direction === 'horizontal' ? 'scrollRight' : 'scrollDown'
  if (direction === 'horizontal') {
    await native.mouseScroll(amount, 'horizontal')
  } else {
    await native.mouseScroll(amount, 'vertical')
  }
}

export const typeText: InputBackend['typeText'] = async (text) => {
  await native.typeText(text)
}

export const getFrontmostAppInfo: InputBackend['getFrontmostAppInfo'] = () => {
  // Synchronous in the native addon.
  // getFrontmostAppInfo is async in the NAPI layer but we expose it
  // synchronously per the InputBackend contract.
  try {
    // The native function returns { bundleId, appName } or null.
    // Since it's async in NAPI, we need to handle it specially.
    // For synchronous callers, we return null and rely on the
    // computer-use-mcp layer which has its own frontmost detection.
    return null
  } catch {
    return null
  }
}
