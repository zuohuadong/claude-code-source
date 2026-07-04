/**
 * Built-in Plugin Initialization
 *
 * Initializes built-in plugins that ship with the CLI and appear in the
 * /plugin UI for users to enable/disable.
 *
 * Not all bundled features should be built-in plugins — use this for
 * features that users should be able to explicitly enable/disable. For
 * features with complex setup or automatic-enabling logic (e.g.
 * claude-in-chrome), use src/skills/bundled/ instead.
 *
 * To add a new built-in plugin:
 * 1. Import registerBuiltinPlugin from '../builtinPlugins.js'
 * 2. Call registerBuiltinPlugin() with the plugin definition here
 */

import { feature } from 'bun:bundle'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { getPlatform } from '../../utils/platform.js'

/**
 * Initialize built-in plugins. Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  // ── Computer Use ──────────────────────────────────────────────────────
  //
  // Computer Use is gated at two layers:
  //   1. feature('CHICAGO_MCP') — compile-time DCE in bun:bundle. Builds
  //      without the flag ship zero CU code.
  //   2. Plugin enabled state — user toggle via /plugin UI. Read by
  //      gates.ts:getChicagoEnabled() at runtime. Default disabled.
  //
  // The plugin is only registered on platforms where CU is functional
  // (macOS + Windows). Linux is supported by the native module but the
  // @ant executor layer (executor.ts) is darwin/win32-guarded today.
  if (feature('CHICAGO_MCP')) {
    registerBuiltinPlugin({
      name: 'computer-use',
      description:
        'Control desktop apps via screenshot, mouse, keyboard, and clipboard. ' +
        'Requires accessibility and screen-recording permissions.',
      version: '1.0.0',
      defaultEnabled: false,
      isAvailable: () => getPlatform() === 'macos' || getPlatform() === 'windows',
      // No skills/hooks/mcpServers here — CU wiring lives in
      // src/utils/computerUse/ and main.tsx's dynamicMcpConfig path.
      // The plugin exists only as the on/off toggle that gates.ts reads.
    })
  }
}
