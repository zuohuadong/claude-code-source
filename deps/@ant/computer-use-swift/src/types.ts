/**
 * Cross-platform types for @ant/computer-use-swift.
 *
 * Mirrors the ComputerExecutor interface from computer-use-mcp/src/executor.ts
 * but scoped to the screenshot/display/window capabilities that
 * computer-use-swift provides.
 */

export interface DisplayGeometry {
  displayId: number
  width: number
  height: number
  scaleFactor: number
  originX: number
  originY: number
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  originX: number
  originY: number
  displayId?: number
}

export interface ZoomResult {
  base64: string
  width: number
  height: number
}

export interface FrontmostApp {
  bundleId: string
  displayName: string
}

export interface InstalledApp {
  bundleId: string
  displayName: string
  path: string
  iconDataUrl?: string
}

export interface PrepareDisplayResult {
  hidden: string[]
  activated: string | null
}

export interface ResolvePrepareCaptureResult extends ScreenshotResult {
  hidden: string[]
  activated: string | null
  displayId: number
}

export interface SwiftBackend {
  screenshot(opts: { allowedBundleIds: string[]; displayId?: number }): Promise<ScreenshotResult | null>
  captureExcluding(opts: { allowedBundleIds: string[]; displayId?: number }): Promise<ScreenshotResult | null>
  captureRegion(opts: {
    allowedBundleIds: string[]
    regionX: number; regionY: number; regionW: number; regionH: number
    outputWidth: number; outputHeight: number
    displayId?: number
  }): Promise<ZoomResult | null>
  listInstalled(): Promise<InstalledApp[]>
  prepareDisplay(opts: { allowedBundleIds: string[]; hostBundleId: string }): Promise<PrepareDisplayResult>
  resolvePrepareCapture(opts: {
    allowedBundleIds: string[]
    hostBundleId: string
    preferredDisplayId?: number
  }): Promise<ResolvePrepareCaptureResult | null>
  display(opts: { displayId?: number }): DisplayGeometry | null
  displayIds(): number[]
  displays(): DisplayGeometry[]
  findWindowDisplays(opts: { bundleIds: string[] }): Array<{ bundleId: string; displayIds: number[] }>
  frontmostApplication(): FrontmostApp | null
  resolveBundleIds(opts: { names: string[] }): string[]
  checkAccessibility(): boolean
  checkScreenRecording(): boolean
  requestAccessibility(): void
  requestScreenRecording(): void
  notifyExpectedEscape(count: number): void
  unhide(opts: { bundleIds: string[] }): void
  open(opts: { bundleId: string }): void
  previewHideSet(opts: { exemptBundleIds: string[] }): Array<{ bundleId: string; displayName: string }>
  drainMainRunLoop(): void
}
