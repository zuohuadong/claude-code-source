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
import path from 'path'

const native = require(
  process.env.COMPUTER_USE_INPUT_NODE_PATH ??
    path.resolve(import.meta.dir, '../../prebuilds/computer-use-input.node'),
)

export const moveMouse: InputBackend['moveMouse'] = async (x, y, animated) => {
  await native.moveMouse(x, y, animated ?? false)
}

export const key: InputBackend['key'] = async (keyName, action) => {
  await native.key(keyName, action ?? 'click')
}

export const keys: InputBackend['keys'] = async (parts) => {
  const chord = parts.join('+')
  await native.keys(chord)
}

export const mouseLocation: InputBackend['mouseLocation'] = async () => {
  return await native.mouseLocation()
}

export const mouseButton: InputBackend['mouseButton'] = async (button, action, count) => {
  await native.mouseButton(button, action, count ?? 1)
}

export const mouseScroll: InputBackend['mouseScroll'] = async (amount, direction) => {
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
  try {
    const info = native.getFrontmostAppInfoSync?.() ?? native.getFrontmostAppInfo?.()
    if (info && typeof info.then !== 'function') return info as FrontmostAppInfo
    return null
  } catch {
    return null
  }
}
