/**
 * Native NAPI module for @ant/computer-use — vendored from zavora-ai/computer-use-mcp.
 *
 * Provides cross-platform (macOS / Windows / Linux) native operations:
 *   - Mouse: move, click, button, scroll, drag, cursor_position
 *   - Keyboard: key_press, type_text, hold_key
 *   - Screenshot: take_screenshot (DXGI + GDI on Windows, CGWindowList on macOS)
 *   - Display: get_display_size, list_displays
 *   - Apps: get_frontmost_app, activate_app, list_running_apps, hide_app, unhide_app, prepare_display
 *   - Windows: list_windows, get_window, get_cursor_window, activate_window
 *   - Clipboard: read_clipboard, write_clipboard
 *
 * The native addon is loaded from prebuilds/<platform>/computer-use-native.node.
 * If unavailable, callers should fall back to their platform-specific TS backend.
 */

import path from 'path'

export interface NativeScreenshotResult {
  base64?: string
  width: number
  height: number
  mimeType?: string
  hash?: string
  unchanged?: boolean
}

export interface NativeDisplayInfo {
  width: number
  height: number
  pixelWidth?: number
  pixelHeight?: number
  scaleFactor?: number
  displayId: number | string
}

export interface NativeAppInfo {
  bundleId: string
  displayName?: string
  pid?: number
  activated?: boolean
}

export interface NativeWindowInfo {
  windowId: number | string
  bundleId: string
  displayName?: string
  pid?: number
  title?: string | null
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  isOnScreen?: boolean
  isFocused?: boolean
  displayId?: number
}

// ---------------------------------------------------------------------------
// Native addon loader
// ---------------------------------------------------------------------------

let native: any = null

try {
  const nativePath =
    process.env.COMPUTER_USE_NATIVE_NODE_PATH ??
    path.resolve(import.meta.dir, './prebuilds/computer-use-native.node')
  native = require(nativePath)
} catch {
  // Native addon not available — caller should fall back to TS backend.
}

export const isNativeAvailable = native !== null

// ---------------------------------------------------------------------------
// Typed re-exports (all optional — only available when native is loaded)
// ---------------------------------------------------------------------------

export const mouseMove: ((x: number, y: number) => void) | undefined =
  native?.mouse_move
export const mouseClick:
  | ((x: number, y: number, button: string, count: number) => void)
  | undefined = native?.mouse_click
export const mouseButton:
  | ((action: string, x: number, y: number) => void)
  | undefined = native?.mouse_button
export const mouseScroll: ((dy: number, dx: number) => void) | undefined =
  native?.mouse_scroll
export const mouseDrag: ((x: number, y: number) => void) | undefined =
  native?.mouse_drag
export const cursorPosition: (() => { x: number; y: number }) | undefined =
  native?.cursor_position

export const keyPress:
  | ((combo: string, repeat?: number) => void)
  | undefined = native?.key_press
export const typeText: ((text: string) => void) | undefined = native?.type_text
export const holdKey:
  | ((keys: string[], durationMs: number) => void)
  | undefined = native?.hold_key

export const takeScreenshot:
  | ((
      width?: number,
      targetApp?: string,
      quality?: number,
      previousHash?: string,
      windowId?: number,
    ) => NativeScreenshotResult)
  | undefined = native?.take_screenshot

export const getDisplaySize:
  | ((displayId?: number) => NativeDisplayInfo)
  | undefined = native?.get_display_size
export const listDisplays: (() => NativeDisplayInfo[]) | undefined =
  native?.list_displays

export const getFrontmostApp: (() => NativeAppInfo | null) | undefined =
  native?.get_frontmost_app
export const activateApp:
  | ((bundleId: string, timeoutMs?: number) => NativeAppInfo)
  | undefined = native?.activate_app
export const listRunningApps: (() => NativeAppInfo[]) | undefined =
  native?.list_running_apps
export const hideApp: ((bundleId: string) => boolean) | undefined =
  native?.hide_app
export const unhideApp: ((bundleId: string) => boolean) | undefined =
  native?.unhide_app
export const prepareDisplay:
  | ((
      targetBundleId: string,
      keepVisible: string[],
    ) => { targetBundleId: string; hiddenBundleIds: string[] })
  | undefined = native?.prepare_display

export const listWindows:
  | ((bundleId?: string) => NativeWindowInfo[])
  | undefined = native?.list_windows
export const getWindow: ((windowId: number) => NativeWindowInfo | null) | undefined =
  native?.get_window
export const getCursorWindow: (() => NativeWindowInfo | null) | undefined =
  native?.get_cursor_window
export const activateWindow:
  | ((windowId: number, timeoutMs?: number) => { windowId: number; activated: boolean })
  | undefined = native?.activate_window

export const readClipboard: (() => string) | undefined = native?.read_clipboard
export const writeClipboard: ((text: string) => void) | undefined =
  native?.write_clipboard

export const drainRunloop: (() => void) | undefined = native?.drainRunloop

export default native
