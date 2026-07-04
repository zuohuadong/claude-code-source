/**
 * Windows (win32) backend for @ant/computer-use-swift.
 *
 * Provides screenshot capture, display enumeration, and window management
 * on Windows using .NET APIs via PowerShell.
 *
 * Screenshot: System.Drawing.Graphics.CopyFromScreen (GDI+)
 * Displays: Screen.AllScreens (System.Windows.Forms)
 * Frontmost: GetForegroundWindow + GetWindowThreadProcessId
 * App list: Start Menu .lnk enumeration
 *
 * Note: Windows does not have ScreenCaptureKit's app-exclusion feature.
 * Screenshots capture all windows. App-level privacy filtering must be
 * handled at the MCP layer (the frontmost gate rejects actions targeting
 * non-allowlisted apps).
 */

import { execSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as path from 'path'
import type {
  SwiftBackend,
  ScreenshotResult,
  ZoomResult,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  PrepareDisplayResult,
  ResolvePrepareCaptureResult,
} from '../types.js'

// ---------------------------------------------------------------------------
// PowerShell helper
// ---------------------------------------------------------------------------

function psSync(script: string): string {
  try {
    return execSync(
      `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 10000, windowsHide: true },
    ).trim()
  } catch {
    return ''
  }
}

async function psAsync(script: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    )
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => resolve(out.trim()))
    proc.on('error', () => resolve(''))
  })
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

export const screenshot: SwiftBackend['screenshot'] = async (opts) => {
  const displayId = opts.displayId ?? 0
  const displayInfo = displays().find(d => d.displayId === displayId) ?? displays()[0]
  if (!displayInfo) return null

  const w = Math.round(displayInfo.width * displayInfo.scaleFactor)
  const h = Math.round(displayInfo.height * displayInfo.scaleFactor)
  const ox = Math.round(displayInfo.originX)
  const oy = Math.round(displayInfo.originY)

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${ox}, ${oy}, 0, 0, (New-Object System.Drawing.Size(${w}, ${h})))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bytes = $ms.ToArray()
[Convert]::ToBase64String($bytes)
$g.Dispose()
$bmp.Dispose()
`

  const base64 = await psAsync(script)
  if (!base64) return null

  return {
    base64,
    width: w,
    height: h,
    displayWidth: Math.round(displayInfo.width),
    displayHeight: Math.round(displayInfo.height),
    originX: ox,
    originY: oy,
    displayId,
  }
}

export const captureExcluding: SwiftBackend['captureExcluding'] = async (opts) => {
  // Windows does not support per-app exclusion at the compositor level.
  // Screenshot captures everything; filtering is done at the MCP gate layer.
  return await screenshot(opts)
}

export const captureRegion: SwiftBackend['captureRegion'] = async (opts) => {
  const { regionX, regionY, regionW, regionH, outputWidth, outputHeight } = opts

  const script = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${outputWidth}, ${outputHeight})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$srcRect = New-Object System.Drawing.Rectangle(${Math.round(regionX)}, ${Math.round(regionY)}, ${Math.round(regionW)}, ${Math.round(regionH)})
$dstRect = New-Object System.Drawing.Rectangle(0, 0, ${outputWidth}, ${outputHeight})
$g.CopyFromScreen(${Math.round(regionX)}, ${Math.round(regionY)}, 0, 0, (New-Object System.Drawing.Size(${Math.round(regionW)}, ${Math.round(regionH)})))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose()
$bmp.Dispose()
`

  const base64 = await psAsync(script)
  if (!base64) return null

  return { base64, width: outputWidth, height: outputHeight }
}

// ---------------------------------------------------------------------------
// Display enumeration
// ---------------------------------------------------------------------------

export const displays: SwiftBackend['displays'] = () => {
  const out = psSync(`
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$result = @()
foreach ($s in $screens) {
  $result += "$($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width),$($s.Bounds.Height),$($s.Primary)"
}
$result -join '|'
`)

  if (!out) return []

  return out.split('|').map((line, i) => {
    const [x, y, w, h, primary] = line.split(',').map(Number)
    return {
      displayId: i,
      width: w,
      height: h,
      scaleFactor: 1, // Windows DPI: would need additional API call
      originX: x,
      originY: y,
    }
  })
}

export const displayIds: SwiftBackend['displayIds'] = () => {
  return displays().map(d => d.displayId)
}

export const display: SwiftBackend['display'] = (opts) => {
  const all = displays()
  if (opts.displayId !== undefined) {
    return all.find(d => d.displayId === opts.displayId) ?? null
  }
  return all[0] ?? null
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

export const findWindowDisplays: SwiftBackend['findWindowDisplays'] = (opts) => {
  // Windows: enumerate via EnumWindows + GetWindowRect, match process paths
  // Simplified: return empty for now, real impl would use UIAutomation
  return opts.bundleIds.map(bid => ({ bundleId: bid, displayIds: [] }))
}

export const frontmostApplication: SwiftBackend['frontmostApplication'] = () => {
  const out = psSync(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text;
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$hwnd = [FW]::GetForegroundWindow()
$pid = [uint32]0
[FW]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
"$($p.MainModule.FileName)|$($p.ProcessName)"
`)
  if (!out || !out.includes('|')) return null
  const [exePath, name] = out.split('|', 2)
  return { bundleId: exePath, displayName: name }
}

// ---------------------------------------------------------------------------
// App listing
// ---------------------------------------------------------------------------

export const listInstalled: SwiftBackend['listInstalled'] = async () => {
  const out = await psAsync(`
$dirs = @(
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu'),
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
)
$shortcuts = Get-ChildItem -Path $dirs -Filter *.lnk -Recurse -ErrorAction SilentlyContinue
$result = @()
foreach ($s in $shortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($s.FullName)
  $result += "$($s.BaseName)|$($lnk.TargetPath)"
}
$result -join [char]10
`)

  if (!out) return []

  return out.split('\n').filter(Boolean).map(line => {
    const [name, exePath] = line.split('|', 2)
    return {
      bundleId: exePath ?? path.basename(name),
      displayName: name,
      path: exePath ?? '',
      iconDataUrl: undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// Permission checks (Windows has no equivalent TCC gates)
// ---------------------------------------------------------------------------

export const checkAccessibility: SwiftBackend['checkAccessibility'] = () => true
export const checkScreenRecording: SwiftBackend['checkScreenRecording'] = () => true
export const requestAccessibility: SwiftBackend['requestAccessibility'] = () => {}
export const requestScreenRecording: SwiftBackend['requestScreenRecording'] = () => {}

// ---------------------------------------------------------------------------
// App management
// ---------------------------------------------------------------------------

export const resolveBundleIds: SwiftBackend['resolveBundleIds'] = (opts) => {
  // Windows uses exe paths, not bundle IDs. Pass through.
  return opts.names
}

export const prepareDisplay: SwiftBackend['prepareDisplay'] = async (_opts) => {
  // Windows does not hide apps at the compositor level.
  return { hidden: [], activated: null }
}

export const resolvePrepareCapture: SwiftBackend['resolvePrepareCapture'] = async (opts) => {
  const shot = await screenshot({ allowedBundleIds: opts.allowedBundleIds, displayId: opts.preferredDisplayId })
  if (!shot) return null
  return {
    ...shot,
    hidden: [],
    activated: null,
    displayId: shot.displayId ?? 0,
  }
}

export const notifyExpectedEscape: SwiftBackend['notifyExpectedEscape'] = () => {
  // Windows: would use SetWindowsHookEx for low-level keyboard hook
}

export const unhide: SwiftBackend['unhide'] = () => {}
export const open: SwiftBackend['open'] = (opts) => {
  psSync(`Start-Process -FilePath "${opts.bundleId}"`)
}
export const previewHideSet: SwiftBackend['previewHideSet'] = () => []
export const drainMainRunLoop: SwiftBackend['drainMainRunLoop'] = () => {}
