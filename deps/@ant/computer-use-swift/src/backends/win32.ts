/**
 * Windows (win32) backend for @ant/computer-use-swift.
 *
 * Priority chain:
 *   1. @ant/computer-use-native (DXGI Desktop Duplication + GDI fallback)
 *   2. PowerShell GDI+ (CopyFromScreen)
 */

import { execSync, spawn } from 'child_process'
import path from 'path'
import type {
  SwiftBackend,
  DisplayGeometry,
  FrontmostApp,
} from '../types.js'

import { loadNative, isNativeAvailable, type NativeModule } from '@ant/computer-use-native'

// ---------------------------------------------------------------------------
// Try native module
// ---------------------------------------------------------------------------

let nativeExec: NativeModule | null = null

if (isNativeAvailable()) {
  try {
    nativeExec = loadNative()
  } catch {
    // Native addon not available — fall through to PowerShell.
  }
}

// ---------------------------------------------------------------------------
// PowerShell helpers (fallback)
// ---------------------------------------------------------------------------

import type { ChildProcessWithoutNullStreams } from 'child_process'

let psProc: ChildProcessWithoutNullStreams | null = null
let psReady = false
let cmdSeq = 0
const pending = new Map<number, { resolve: (v: string) => void; timer: ReturnType<typeof setTimeout> }>()

function getPs(): ChildProcessWithoutNullStreams {
  if (psProc && !psProc.killed) return psProc
  psProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true })

  let buf = ''
  psProc.stdout.on('data', (data: Buffer) => {
    buf += data.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!psReady && trimmed === 'CU_PS_READY') { psReady = true; continue }
      const match = trimmed.match(/^__CU_(\d+)__(.*)$/)
      if (match) {
        const id = parseInt(match[1], 10)
        const handler = pending.get(id)
        if (handler) { pending.delete(id); clearTimeout(handler.timer); handler.resolve(match[2]) }
      }
    }
  })
  psProc.stderr.on('data', () => {})
  psProc.on('error', () => { psProc = null; psReady = false })
  psProc.on('close', () => { psProc = null; psReady = false })

  psProc.stdin.write(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CUDpi { [DllImport("user32.dll")] public static extern int SetProcessDPIAware(); }'; [CUDpi]::SetProcessDPIAware() | Out-Null
Write-Output "CU_PS_READY"
`)
  return psProc
}

function psRun(script: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    const proc = getPs()
    const id = ++cmdSeq
    const timer = setTimeout(() => { pending.delete(id); resolve('') }, timeoutMs)
    pending.set(id, { resolve, timer })
    proc.stdin.write(`${script}; Write-Output "__CU_${id}__done"\n`)
  })
}

function psSync(script: string): string {
  try {
    return execSync(`powershell.exe -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', timeout: 10000, windowsHide: true }).trim()
  } catch { return '' }
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

let displayCache: DisplayGeometry[] | null = null
let displayCacheTime = 0
const DISPLAY_CACHE_TTL = 5000

// ---------------------------------------------------------------------------
// Display enumeration
// ---------------------------------------------------------------------------

export const displays: SwiftBackend['displays'] = (): DisplayGeometry[] => {
  const now = Date.now()
  if (displayCache && now - displayCacheTime < DISPLAY_CACHE_TTL) return displayCache

  // Try native first
  if (nativeExec?.listDisplays) {
    try {
      const nativeDisplays = nativeExec.listDisplays()
      if (nativeDisplays && nativeDisplays.length > 0) {
        const result: DisplayGeometry[] = nativeDisplays.map((d, i) => ({
          displayId: typeof d.displayId === 'number' ? d.displayId : i,
          width: d.width,
          height: d.height,
          scaleFactor: d.scaleFactor ?? 1,
          originX: 0,
          originY: 0,
        }))
        displayCache = result
        displayCacheTime = now
        return result
      }
    } catch { /* fall through */ }
  }

  // PowerShell fallback
  const out = psSync(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CUDpi2 { [DllImport("user32.dll")] public static extern int SetProcessDPIAware(); }'; [CUDpi2]::SetProcessDPIAware() | Out-Null
$screens = [System.Windows.Forms.Screen]::AllScreens
$result = @()
foreach ($s in $screens) {
  $result += "$($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width),$($s.Bounds.Height),$($s.Primary),$($s.Bounds.Right),$($s.Bounds.Bottom)"
}
$result -join '|'
`)

  if (!out) { displayCache = []; displayCacheTime = now; return displayCache }

  const result = out.split('|').map((line, i) => {
    const parts = line.split(',').map(Number)
    return { displayId: i, width: parts[2], height: parts[3], scaleFactor: 1, originX: parts[0], originY: parts[1] }
  })
  displayCache = result
  displayCacheTime = now
  return result
}

export const displayIds: SwiftBackend['displayIds'] = () => displays().map(d => d.displayId)

export const display: SwiftBackend['display'] = (opts) => {
  const all = displays()
  if (opts.displayId !== undefined) return all.find(d => d.displayId === opts.displayId) ?? null
  return all[0] ?? null
}

// ---------------------------------------------------------------------------
// Screenshot — native DXGI + GDI fallback via PowerShell
// ---------------------------------------------------------------------------

export const screenshot: SwiftBackend['screenshot'] = async (opts) => {
  const displayId = opts.displayId ?? 0
  const all = displays()
  const displayInfo = all.find(d => d.displayId === displayId) ?? all[0]
  if (!displayInfo) return null

  const w = Math.round(displayInfo.width)
  const h = Math.round(displayInfo.height)
  const ox = Math.round(displayInfo.originX)
  const oy = Math.round(displayInfo.originY)

  // Try native DXGI capture first
  if (nativeExec?.takeScreenshot) {
    try {
      const result = nativeExec.takeScreenshot(undefined, undefined, 80)
      if (result && result.base64 && !result.unchanged) {
        return {
          base64: result.base64,
          width: result.width,
          height: result.height,
          displayWidth: result.width,
          displayHeight: result.height,
          originX: ox,
          originY: oy,
          displayId,
        }
      }
    } catch { /* fall through to PowerShell */ }
  }

  // PowerShell GDI+ fallback
  const base64 = await psRun(`
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${ox}, ${oy}, 0, 0, (New-Object System.Drawing.Size(${w}, ${h})))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose(); $bmp.Dispose()
`)

  if (!base64) return null
  return { base64, width: w, height: h, displayWidth: w, displayHeight: h, originX: ox, originY: oy, displayId }
}

export const captureExcluding: SwiftBackend['captureExcluding'] = async (opts) => {
  // Windows has no per-app compositor exclusion. Capture full screen.
  return await screenshot(opts)
}

export const captureRegion: SwiftBackend['captureRegion'] = async (opts) => {
  const { regionX, regionY, regionW, regionH, outputWidth, outputHeight } = opts
  const rx = Math.round(regionX)
  const ry = Math.round(regionY)
  const rw = Math.round(regionW)
  const rh = Math.round(regionH)

  // Try native crop first
  if (nativeExec?.takeScreenshot) {
    try {
      const full = nativeExec.takeScreenshot(undefined, undefined, 80)
      if (full && full.base64 && !full.unchanged) {
        // Native doesn't support region crop directly — use full + TS crop
        // For now, fall through to PowerShell for region capture
      }
    } catch { /* fall through */ }
  }

  // PowerShell GDI+ region capture
  const base64 = await psRun(`
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${outputWidth}, ${outputHeight})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${rx}, ${ry}, 0, 0, (New-Object System.Drawing.Size(${rw}, ${rh})))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose(); $bmp.Dispose()
`)

  if (!base64) return null
  return { base64, width: outputWidth, height: outputHeight }
}

// ---------------------------------------------------------------------------
// Window display mapping — native EnumWindows with PowerShell fallback
// ---------------------------------------------------------------------------

export const findWindowDisplays: SwiftBackend['findWindowDisplays'] = (opts) => {
  // Try native list_windows first
  if (nativeExec?.listWindows) {
    try {
      const windows = nativeExec.listWindows()
      if (windows) {
        const result: Array<{ bundleId: string; displayIds: number[] }> = []
        for (const bundleId of opts.bundleIds) {
          const matching = windows.filter(
            (w) => w.bundleId?.toLowerCase() === bundleId.toLowerCase() ||
                   w.bundleId?.toLowerCase().replace('.exe', '') === bundleId.toLowerCase().replace('.exe', ''),
          )
          const displayIdsSet = new Set(matching.map((w) => w.displayId ?? 0))
          result.push({ bundleId, displayIds: [...displayIdsSet] })
        }
        return result
      }
    } catch { /* fall through */ }
  }

  // PowerShell EnumWindows fallback
  const out = psSync(`
Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Diagnostics; using System.Text;
public class CUWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static string Enumerate() {
    var results = new List<string>();
    EnumWindows((hWnd, lp) => {
      if (!IsWindowVisible(hWnd)) return true;
      RECT r; if (!GetWindowRect(hWnd, out r)) return true;
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      try { var p = Process.GetProcessById((int)pid); var name = p.MainModule != null ? p.MainModule.FileName : p.ProcessName; results.Add(name + "|" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom); } catch { }
      return true;
    }, IntPtr.Zero);
    return string.Join(";", results);
  }
}
[CUWin]::Enumerate()
`)
  if (!out) return []

  const allWindows = out.split(';').filter(Boolean).map((line) => {
    const [exe, rectStr] = line.split('|')
    const [l, t, r, b] = rectStr.split(',').map(Number)
    return { exe, centerX: (l + r) / 2, centerY: (t + b) / 2 }
  })

  const monitorBounds = displays().map((d) => ({
    displayId: d.displayId,
    left: d.originX,
    top: d.originY,
    right: d.originX + d.width,
    bottom: d.originY + d.height,
  }))

  const result: Array<{ bundleId: string; displayIds: number[] }> = []
  for (const bundleId of opts.bundleIds) {
    const lower = bundleId.toLowerCase()
    const matching = allWindows.filter((w) => w.exe.toLowerCase().includes(lower.replace('.exe', '')))
    const displayIdsSet = new Set<number>()
    for (const win of matching) {
      for (const m of monitorBounds) {
        if (win.centerX >= m.left && win.centerX < m.right && win.centerY >= m.top && win.centerY < m.bottom) {
          displayIdsSet.add(m.displayId)
        }
      }
    }
    result.push({ bundleId, displayIds: [...displayIdsSet] })
  }
  return result
}

// ---------------------------------------------------------------------------
// App management — native + PowerShell fallback
// ---------------------------------------------------------------------------

export const frontmostApplication: SwiftBackend['frontmostApplication'] = (): FrontmostApp | null => {
  if (nativeExec?.getFrontmostApp) {
    try {
      const app = nativeExec.getFrontmostApp()
      if (app) return { bundleId: app.bundleId, displayName: app.displayName ?? app.bundleId }
    } catch { /* fall through */ }
  }
  const out = psSync(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Diagnostics; public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $h = [W]::GetForegroundWindow(); $pid = [uint32]0; [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; $p = Get-Process -Id $pid -ErrorAction SilentlyContinue; "$($p.ProcessName)|$($p.MainModule.FileName)"`)
  if (!out || !out.includes('|')) return null
  const [name, exePath] = out.split('|', 2)
  return { bundleId: exePath ?? name, displayName: name }
}

export const listInstalled: SwiftBackend['listInstalled'] = async () => {
  // Windows: enumerate Start Menu .lnk files
  const out = psSync(`
$dirs = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")
$apps = @()
foreach ($dir in $dirs) {
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Filter *.lnk -Recurse | ForEach-Object {
      $sh = New-Object -ComObject WScript.Shell
      $shortcut = $sh.CreateShortcut($_.FullName)
      $apps += "$($_.BaseName)|$($shortcut.TargetPath)"
    }
  }
}
$apps -join "\r\n"
`)
  if (!out) return []
  return out.split('\n').filter(Boolean).map((line) => {
    const [name, targetPath] = line.split('|', 2)
    return { bundleId: targetPath ?? name, displayName: name, path: targetPath ?? '' }
  })
}

export const prepareDisplay: SwiftBackend['prepareDisplay'] = async (opts) => {
  if (nativeExec?.prepareDisplay) {
    try {
      const result = nativeExec.prepareDisplay(opts.hostBundleId, opts.allowedBundleIds)
      if (result) return { hidden: result.hiddenBundleIds, activated: opts.hostBundleId }
    } catch { /* fall through */ }
  }
  return { hidden: [], activated: opts.hostBundleId }
}

export const resolvePrepareCapture: SwiftBackend['resolvePrepareCapture'] = async (opts) => {
  const prep = await prepareDisplay(opts)
  const shot = await screenshot({ allowedBundleIds: opts.allowedBundleIds, displayId: opts.preferredDisplayId })
  if (!shot) return null
  return { ...shot, hidden: prep.hidden, activated: prep.activated, displayId: opts.preferredDisplayId ?? 0 }
}

export const resolveBundleIds: SwiftBackend['resolveBundleIds'] = (opts) => {
  return opts.names.map((n) => n.toLowerCase().endsWith('.exe') ? n : `${n}.exe`)
}

export const checkAccessibility: SwiftBackend['checkAccessibility'] = () => true
export const checkScreenRecording: SwiftBackend['checkScreenRecording'] = () => true
export const requestAccessibility: SwiftBackend['requestAccessibility'] = () => {}
export const requestScreenRecording: SwiftBackend['requestScreenRecording'] = () => {}

export const notifyExpectedEscape: SwiftBackend['notifyExpectedEscape'] = () => {}
export const unhide: SwiftBackend['unhide'] = (unhideOpts) => {
  if (nativeExec?.unhideApp) {
    for (const bundleId of unhideOpts.bundleIds) {
      try { nativeExec.unhideApp(bundleId) } catch { /* ignore */ }
    }
  }
}

export const open: SwiftBackend['open'] = (opts) => {
  // Windows: use Start-Process or ShellExecute
  psSync(`Start-Process "${opts.bundleId}"`)
}

export const previewHideSet: SwiftBackend['previewHideSet'] = () => []
export const drainMainRunLoop: SwiftBackend['drainMainRunLoop'] = () => {
  nativeExec?.drainRunloop?.()
}
