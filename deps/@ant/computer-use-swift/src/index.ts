import type {
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ResolvePrepareCaptureResult,
  ScreenshotResult,
  SwiftBackend,
  ZoomResult,
} from './types.js'
import path from 'path'

export interface ComputerUseAPI {
  display: {
    getSize(displayId?: number): DisplayGeometry
    listAll(): DisplayGeometry[]
  }
  screenshot: {
    captureExcluding(
      allowedBundleIds: string[],
      quality: number,
      width: number,
      height: number,
      displayId?: number,
    ): Promise<ScreenshotResult>
    captureRegion(
      allowedBundleIds: string[],
      x: number,
      y: number,
      w: number,
      h: number,
      outW: number,
      outH: number,
      quality: number,
      displayId?: number,
    ): Promise<ZoomResult>
  }
  apps: {
    prepareDisplay(allowlistBundleIds: string[], hostBundleId: string, displayId?: number): Promise<{ hidden: string[]; activated?: string | null }>
    previewHideSet(allowlistBundleIds: string[], displayId?: number): Promise<Array<{ bundleId: string; displayName: string }>>
    findWindowDisplays(bundleIds: string[]): Promise<Array<{ bundleId: string; displayIds: number[] }>>
    appUnderPoint(x: number, y: number): Promise<FrontmostApp | null>
    listInstalled(): Promise<InstalledApp[]>
    iconDataUrl(path: string): string | undefined
    listRunning(): Promise<Array<{ bundleId: string; displayName: string; pid?: number }>>
    open(bundleId: string): Promise<void>
    unhide(bundleIds: string[]): Promise<void>
  }
  resolvePrepareCapture(
    allowedBundleIds: string[],
    hostBundleId: string,
    quality: number,
    width: number,
    height: number,
    preferredDisplayId?: number,
    autoResolve?: boolean,
    doHide?: boolean,
  ): Promise<ResolvePrepareCaptureResult>
  tcc: {
    checkAccessibility(): boolean
    checkScreenRecording(): boolean
    requestAccessibility(): void
    requestScreenRecording(): void
  }
  hotkey: {
    registerEscape(onEscape: () => void): boolean
    unregister(): void
    notifyExpectedEscape(): void
  }
  _drainMainRunLoop(): void
}

let backend: SwiftBackend | null = null

function loadWin32Backend(): SwiftBackend {
  if (backend) return backend

  switch (process.platform) {
    case 'win32': {
      const mod = require('./backends/win32.js')
      backend = mod as SwiftBackend
      break
    }
    default:
      throw new Error(
        `@ant/computer-use-swift is not supported on platform: ${process.platform}`,
      )
  }

  return backend
}

export const isSupported = process.platform === 'darwin' || process.platform === 'win32'

export function getBackend(): SwiftBackend {
  if (process.platform !== 'win32') {
    throw new Error('The SwiftBackend adapter is only used by the Windows TypeScript backend')
  }
  return loadWin32Backend()
}

function requireResult<T>(value: T | null, operation: string): T {
  if (value === null) throw new Error(`${operation} returned null`)
  return value
}

function createApi(cu: SwiftBackend): ComputerUseAPI {
  return {
    display: {
      getSize(displayId?: number) {
        return requireResult(cu.display({ displayId }), 'display.getSize')
      },
      listAll() {
        return cu.displays()
      },
    },
    screenshot: {
      async captureExcluding(allowedBundleIds, _quality, width, height, displayId) {
        return requireResult(
          await cu.captureExcluding({ allowedBundleIds, displayId }),
          'screenshot.captureExcluding',
        )
      },
      async captureRegion(allowedBundleIds, x, y, w, h, outW, outH, _quality, displayId) {
        return requireResult(
          await cu.captureRegion({
            allowedBundleIds,
            regionX: x,
            regionY: y,
            regionW: w,
            regionH: h,
            outputWidth: outW,
            outputHeight: outH,
            displayId,
          }),
          'screenshot.captureRegion',
        )
      },
    },
    apps: {
      async prepareDisplay(allowlistBundleIds, hostBundleId) {
        return await cu.prepareDisplay({ allowedBundleIds: allowlistBundleIds, hostBundleId })
      },
      async previewHideSet(allowlistBundleIds) {
        return cu.previewHideSet({ exemptBundleIds: allowlistBundleIds })
      },
      async findWindowDisplays(bundleIds) {
        return cu.findWindowDisplays({ bundleIds })
      },
      async appUnderPoint() {
        return null
      },
      async listInstalled() {
        return await cu.listInstalled()
      },
      iconDataUrl() {
        return undefined
      },
      async listRunning() {
        const frontmost = cu.frontmostApplication()
        return frontmost ? [{ ...frontmost }] : []
      },
      async open(bundleId) {
        cu.open({ bundleId })
      },
      async unhide(bundleIds) {
        cu.unhide({ bundleIds })
      },
    },
    async resolvePrepareCapture(allowedBundleIds, hostBundleId, _quality, _width, _height, preferredDisplayId, _autoResolve, doHide = true) {
      if (!doHide) {
        const shot = requireResult(
          await cu.captureExcluding({ allowedBundleIds, displayId: preferredDisplayId }),
          'resolvePrepareCapture.capture',
        )
        return { ...shot, hidden: [], activated: null, displayId: shot.displayId ?? preferredDisplayId ?? 0 }
      }
      return requireResult(
        await cu.resolvePrepareCapture({ allowedBundleIds, hostBundleId, preferredDisplayId }),
        'resolvePrepareCapture',
      )
    },
    tcc: {
      checkAccessibility: cu.checkAccessibility,
      checkScreenRecording: cu.checkScreenRecording,
      requestAccessibility: cu.requestAccessibility,
      requestScreenRecording: cu.requestScreenRecording,
    },
    hotkey: {
      registerEscape: () => false,
      unregister: () => {},
      notifyExpectedEscape: () => cu.notifyExpectedEscape(1),
    },
    _drainMainRunLoop: cu.drainMainRunLoop,
  }
}

function loadDarwinApi(): ComputerUseAPI {
  const native = require(
    process.env.COMPUTER_USE_SWIFT_NODE_PATH ??
      path.resolve(import.meta.dir, '../prebuilds/computer_use.node'),
  )
  return native.computerUse as ComputerUseAPI
}

const api = process.platform === 'darwin'
  ? loadDarwinApi()
  : createApi(loadWin32Backend())

export const display = api.display
export const screenshot = api.screenshot
export const apps = api.apps
export const resolvePrepareCapture = api.resolvePrepareCapture
export const tcc = api.tcc
export const hotkey = api.hotkey
export const _drainMainRunLoop = api._drainMainRunLoop

export default api

export type {
  SwiftBackend,
  ScreenshotResult,
  ZoomResult,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  PrepareDisplayResult,
  ResolvePrepareCaptureResult,
} from './types.js'
