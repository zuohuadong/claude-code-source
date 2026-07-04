import type { ComputerUseAPI } from '@ant/computer-use-swift'

let cached: ComputerUseAPI | undefined

/**
 * The package's TS loader reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise, then falls through
 * to the bundled prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cached ??= require('@ant/computer-use-swift') as ComputerUseAPI)
}

export type { ComputerUseAPI }
