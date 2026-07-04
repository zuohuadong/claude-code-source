/**
 * Platform-aware loader for @ant/computer-use-input.
 *
 * Selects the appropriate backend based on process.platform:
 *   darwin -> native .node addon (Rust/NAPI-RS + enigo)
 *   win32  -> PowerShell + Win32 P/Invoke backend
 *   other  -> throws (not supported)
 *
 * The exported object conforms to the InputBackend interface.
 */

import type { InputBackend } from './types.js'

let backend: InputBackend | null = null

function loadBackend(): InputBackend {
  if (backend) return backend

  switch (process.platform) {
    case 'darwin': {
      const mod = require('./backends/darwin.js')
      backend = mod as InputBackend
      break
    }
    case 'win32': {
      const mod = require('./backends/win32.js')
      backend = mod as InputBackend
      break
    }
    default:
      throw new Error(
        `@ant/computer-use-input is not supported on platform: ${process.platform}`,
      )
  }

  return backend
}

export const isSupported = process.platform === 'darwin' || process.platform === 'win32'

export function getBackend(): InputBackend {
  return loadBackend()
}

// Re-export all backend methods for convenience
export const {
  moveMouse,
  key,
  keys,
  mouseLocation,
  mouseButton,
  mouseScroll,
  typeText,
  getFrontmostAppInfo,
} = loadBackend()

export type { InputBackend, FrontmostAppInfo } from './types.js'
