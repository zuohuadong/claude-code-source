/**
 * Native NAPI module adapter for @ant/computer-use.
 *
 * Loads prebuilt native binaries from @zavora-ai/computer-use-mcp npm package.
 * The package ships platform-specific .node files:
 *   - computer-use-napi.darwin-arm64.node
 *   - computer-use-napi.darwin-x64.node
 *   - computer-use-napi.win32-x64.node
 *   - computer-use-napi.linux-x64.node
 *   - computer-use-napi.linux-arm64.node
 *
 * This adapter re-exports the typed NativeModule interface and provides
 * convenience wrappers that map zavora function names to @ant conventions.
 */

import { createRequire } from 'module'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Types (re-exported from zavora's native.d.ts)
// ---------------------------------------------------------------------------

export interface AXBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AXElement {
  role: string
  label: string | null
  value: string | null
  bounds: AXBounds
  actions: string[]
  children?: AXElement[]
  path?: number[]
  truncated?: boolean
}

export interface MenuItem {
  title: string
  enabled: boolean
  shortcut?: string
  submenu?: MenuItem[]
}

export interface MenuBarEntry {
  title: string
  enabled: boolean
  items: MenuItem[]
}

export interface WindowRecord {
  windowId: number
  bundleId: string | null
  displayName: string
  pid: number
  title: string | null
  bounds: AXBounds
  isOnScreen: boolean
  isFocused: boolean
  displayId: number
}

export interface NativeModule {
  mouseMove(x: number, y: number): void
  mouseClick(x: number, y: number, button: string, count: number): void
  mouseButton(action: string, x: number, y: number): void
  mouseScroll(dy: number, dx: number): void
  mouseDrag(x: number, y: number): void
  cursorPosition(): { x: number; y: number }
  keyPress(combo: string, repeat?: number): void
  typeText(text: string): void
  holdKey(keys: string[], durationMs: number): void
  activateApp(bundleId: string, timeoutMs?: number): {
    bundleId: string
    activated: boolean
    displayName?: string
  }
  getFrontmostApp(): {
    bundleId: string
    displayName: string
    pid: number
  } | null
  getWindow(windowId: number): WindowRecord | null
  getCursorWindow(): WindowRecord | null
  activateWindow(windowId: number, timeoutMs?: number): {
    windowId: number
    activated: boolean
    reason: string | null
  }
  listWindows(bundleId?: string): Array<WindowRecord>
  listRunningApps(): Array<{
    bundleId: string
    displayName: string
    pid: number
    isHidden: boolean
  }>
  hideApp(bundleId: string): boolean
  unhideApp(bundleId: string): boolean
  getDisplaySize(displayId?: number): {
    width: number
    height: number
    pixelWidth: number
    pixelHeight: number
    scaleFactor: number
    displayId: number
  }
  listDisplays(): Array<{
    width: number
    height: number
    scaleFactor: number
    displayId: number
  }>
  takeScreenshot(
    width?: number,
    targetApp?: string,
    quality?: number,
    previousHash?: string,
    windowId?: number,
  ): {
    base64?: string
    width: number
    height: number
    mimeType: string
    hash: string
    unchanged: boolean
  }
  getUiTree(windowId: number, maxDepth?: number): AXElement
  getFocusedElement(): AXElement | null
  findElement(
    windowId: number,
    role?: string,
    label?: string,
    value?: string,
    maxResults?: number,
  ): AXElement[]
  performAction(
    windowId: number,
    role: string,
    label: string,
    action: string,
  ): { performed: boolean; reason?: string; bounds?: AXBounds }
  setElementValue(
    windowId: number,
    role: string,
    label: string,
    value: string,
  ): { set: boolean; reason?: string }
  getMenuBar(bundleId: string): MenuBarEntry[]
  pressMenuItem(
    bundleId: string,
    menu: string,
    item: string,
    submenu?: string,
  ): { pressed: boolean; reason?: string }
  listSpaces(): {
    supported: boolean
    reason?: string
    active_space_id: number | null
    displays: Array<{
      display_id: string
      spaces: Array<{ id: number; type: number; uuid: string }>
    }>
  }
  getActiveSpace(): number | null
  createAgentSpace(): {
    supported: boolean
    spaceId?: number
    attached?: boolean
    reason?: string
    note?: string
  }
  moveWindowToSpace(
    windowId: number,
    spaceId: number,
  ): {
    moved: boolean
    verified?: boolean
    reason?: string
    note?: string
    window_on_screen_before?: boolean
    window_on_screen_after?: boolean
  }
  removeWindowFromSpace(
    windowId: number,
    spaceId: number,
  ): { removed: boolean; reason?: string }
  destroySpace(spaceId: number): { destroyed: boolean; reason?: string }
  drainRunloop(): void
  readClipboard?(): string
  writeClipboard?(text: string): void
  annotateImage(
    base64Jpeg: string,
    annotations: string | null,
    gridCols: number | null,
    gridRows: number | null,
    quality: number | null,
  ): { base64: string; width: number; height: number; mimeType: string }
  cropImage(
    base64Image: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    quality: number | null,
  ): { base64: string; width: number; height: number; mimeType: string }
  prepareDisplay(
    targetBundleId: string,
    keepVisible: string[],
  ): { targetBundleId: string; hiddenBundleIds: string[] }
}

// ---------------------------------------------------------------------------
// Native module loader — uses zavora's loadNative()
// ---------------------------------------------------------------------------

const SUPPORTED_TARGETS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
]

function resolveAddonPath(): string {
  const platform = process.platform
  const arch = process.arch
  const isSupported = SUPPORTED_TARGETS.some(
    (t) => t.platform === platform && t.arch === arch,
  )
  if (!isSupported) {
    const supported = SUPPORTED_TARGETS.map((t) => `${t.platform}-${t.arch}`).join(', ')
    throw new Error(
      `Unsupported platform: ${platform}-${arch}. Supported: ${supported}`,
    )
  }

  const binaryName = `computer-use-napi.${platform}-${arch}.node`

  // Allow override via env var
  const override = process.env.COMPUTER_USE_NATIVE_NODE_PATH
  if (override && existsSync(override)) {
    return override
  }

  // Load from @zavora-ai/computer-use-mcp package root
  // The .node files are at the package root, next to package.json
  const require = createRequire(import.meta.url)
  let pkgRoot: string
  try {
    pkgRoot = dirname(require.resolve('@zavora-ai/computer-use-mcp/package.json'))
  } catch {
    throw new Error(
      '@zavora-ai/computer-use-mcp is not installed. Run: bun add @zavora-ai/computer-use-mcp',
    )
  }

  const binaryPath = join(pkgRoot, binaryName)
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Native binary not found: ${binaryName}. Expected at ${binaryPath}.`,
    )
  }
  return binaryPath
}

let cached: NativeModule | null = null

export function loadNative(): NativeModule {
  if (cached) return cached
  const require = createRequire(import.meta.url)
  const addonPath = resolveAddonPath()
  cached = require(addonPath) as NativeModule
  return cached
}

export function isNativeAvailable(): boolean {
  try {
    loadNative()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Convenience re-exports — typed function references
// ---------------------------------------------------------------------------

export const native = (): NativeModule => loadNative()

export default { loadNative, isNativeAvailable }
