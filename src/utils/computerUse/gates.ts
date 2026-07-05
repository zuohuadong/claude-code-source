import type { CoordinateMode, CuSubGates } from '@ant/computer-use-mcp/types'

import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { BUILTIN_MARKETPLACE_NAME } from '../../plugins/builtinPlugins.js'
import { getSubscriptionType } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'

const COMPUTER_USE_PLUGIN_ID = `computer-use@${BUILTIN_MARKETPLACE_NAME}`

type ChicagoConfig = CuSubGates & {
  coordinateMode: CoordinateMode
}

const DEFAULTS: ChicagoConfig = {
  pixelValidation: false,
  clipboardPasteMultiline: true,
  mouseAnimation: true,
  hideBeforeAction: true,
  autoTargetDisplay: true,
  clipboardGuard: true,
  coordinateMode: 'pixels',
}

// Spread over defaults so a partial JSON ({"enabled": true} alone) inherits the
// rest. The generic on getDynamicConfig is a type assertion, not a validator —
// GB returning a partial object would otherwise surface undefined fields.
function readConfig(): ChicagoConfig {
  return {
    ...DEFAULTS,
    ...getDynamicConfig_CACHED_MAY_BE_STALE<Partial<ChicagoConfig>>(
      'tengu_malort_pedway',
      DEFAULTS,
    ),
  }
}

// Max/Pro only for external rollout. Ant bypass so dogfooding continues
// regardless of subscription tier — not all ants are max/pro, and per
// CLAUDE.md:281, USER_TYPE !== 'ant' branches get zero antfooding.
function hasRequiredSubscription(): boolean {
  if (process.env.USER_TYPE === 'ant') return true
  const tier = getSubscriptionType()
  return tier === 'max' || tier === 'pro'
}

/**
 * Read the user's plugin enabled state for Computer Use.
 *
 * Returns:
 *   - true/false when the user has explicitly toggled the plugin via /plugin
 *   - undefined when no preference is set (built-in plugin default applies)
 */
function getPluginEnabledPreference(): boolean | undefined {
  const settings = getSettings_DEPRECATED()
  const raw = settings?.enabledPlugins?.[COMPUTER_USE_PLUGIN_ID]
  if (Array.isArray(raw)) {
    return raw.length > 0
  }
  if (typeof raw === 'boolean') {
    return raw
  }
  return undefined
}

/**
 * Computer Use is enabled when BOTH conditions hold:
 *   1. The /plugin toggle is explicitly on
 *   2. The subscription tier allows it (Max/Pro, or ant bypass)
 *
 * GrowthBook still supplies sub-gates and coordinate-mode config, but it must
 * not enable CU by itself. Otherwise the /plugin UI can show the built-in
 * plugin as disabled while the runtime starts the MCP server anyway.
 */
export function getChicagoEnabled(): boolean {
  // Disable for ants whose shell inherited monorepo dev config.
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.MONOREPO_ROOT_DIR &&
    !isEnvTruthy(process.env.ALLOW_ANT_COMPUTER_USE_MCP)
  ) {
    return false
  }

  if (!hasRequiredSubscription()) {
    return false
  }

  return getPluginEnabledPreference() === true
}

export function getChicagoSubGates(): CuSubGates {
  const { coordinateMode: _c, ...subGates } = readConfig()
  return subGates
}

// Frozen at first read — setup.ts builds tool descriptions and executor.ts
// scales coordinates off the same value. A live read here lets a mid-session
// GB flip tell the model "pixels" while transforming clicks as normalized.
let frozenCoordinateMode: CoordinateMode | undefined
export function getChicagoCoordinateMode(): CoordinateMode {
  frozenCoordinateMode ??= readConfig().coordinateMode
  return frozenCoordinateMode
}
