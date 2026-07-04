/**
 * Platform-aware loader for @ant/computer-use-swift.
 *
 * Selects the appropriate backend based on process.platform:
 *   darwin -> native .node addon (Swift + ScreenCaptureKit)
 *   win32  -> PowerShell + .NET backend
 *   other  -> throws (not supported)
 */

import type { SwiftBackend } from './types.js'

let backend: SwiftBackend | null = null

function loadBackend(): SwiftBackend {
  if (backend) return backend

  switch (process.platform) {
    case 'darwin': {
      const mod = require('./backends/darwin.js')
      backend = mod as SwiftBackend
      break
    }
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
  return loadBackend()
}

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
