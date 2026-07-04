/**
 * macOS (darwin) backend for @ant/computer-use-swift.
 *
 * Delegates to the native computer_use.node Swift addon.
 * The addon provides: ScreenCaptureKit screenshots with app exclusion,
 * Spotlight app enumeration, display management, window hide/unhide,
 * ESC key tap abort, and run-loop pumping for libuv consumers.
 *
 * Four methods (captureExcluding, captureRegion, listInstalled,
 * resolvePrepareCapture) use Task { @MainActor in ... } which enqueues
 * onto DispatchQueue.main. Under Electron, CFRunLoop drains this
 * automatically. Under Node/Bun, call _drainMainRunLoop via setInterval.
 */

import type { SwiftBackend } from '../types.js'
import path from 'path'

const native = require(
  process.env.COMPUTER_USE_SWIFT_NODE_PATH ??
    path.resolve(import.meta.dir, '../../prebuilds/computer_use.node'),
).computerUse

export const screenshot: SwiftBackend['screenshot'] = async (opts) => {
  return await native.screenshot(opts)
}

export const captureExcluding: SwiftBackend['captureExcluding'] = async (opts) => {
  return await native.captureExcluding(opts)
}

export const captureRegion: SwiftBackend['captureRegion'] = async (opts) => {
  return await native.captureRegion(opts)
}

export const listInstalled: SwiftBackend['listInstalled'] = async () => {
  return await native.listInstalled()
}

export const prepareDisplay: SwiftBackend['prepareDisplay'] = async (opts) => {
  return await native.prepareDisplay(opts)
}

export const resolvePrepareCapture: SwiftBackend['resolvePrepareCapture'] = async (opts) => {
  return await native.resolvePrepareCapture(opts)
}

export const display: SwiftBackend['display'] = (opts) => {
  return native.display(opts)
}

export const displayIds: SwiftBackend['displayIds'] = () => {
  return native.displayIds()
}

export const displays: SwiftBackend['displays'] = () => {
  return native.displays()
}

export const findWindowDisplays: SwiftBackend['findWindowDisplays'] = (opts) => {
  return native.findWindowDisplays(opts)
}

export const frontmostApplication: SwiftBackend['frontmostApplication'] = () => {
  return native.frontmostApplication()
}

export const resolveBundleIds: SwiftBackend['resolveBundleIds'] = (opts) => {
  return native.resolveBundleIds(opts)
}

export const checkAccessibility: SwiftBackend['checkAccessibility'] = () => {
  return native.checkAccessibility()
}

export const checkScreenRecording: SwiftBackend['checkScreenRecording'] = () => {
  return native.checkScreenRecording()
}

export const requestAccessibility: SwiftBackend['requestAccessibility'] = () => {
  return native.requestAccessibility()
}

export const requestScreenRecording: SwiftBackend['requestScreenRecording'] = () => {
  return native.requestScreenRecording()
}

export const notifyExpectedEscape: SwiftBackend['notifyExpectedEscape'] = (count) => {
  return native.notifyExpectedEscape(count)
}

export const unhide: SwiftBackend['unhide'] = (opts) => {
  return native.unhide(opts)
}

export const open: SwiftBackend['open'] = (opts) => {
  return native.open(opts)
}

export const previewHideSet: SwiftBackend['previewHideSet'] = (opts) => {
  return native.previewHideSet(opts)
}

export const drainMainRunLoop: SwiftBackend['drainMainRunLoop'] = () => {
  return native._drainMainRunLoop()
}
