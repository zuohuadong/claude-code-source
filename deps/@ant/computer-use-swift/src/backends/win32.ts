/**
 * Windows (win32) backend for @ant/computer-use-swift.
 *
 * Provides screenshot capture, display enumeration, window management,
 * and app listing on Windows using .NET APIs via PowerShell.
 *
 * Screenshot: System.Drawing.Graphics.CopyFromScreen (GDI+)
 * Displays: Screen.AllScreens with DPI awareness (System.Windows.Forms)
 * Frontmost: GetForegroundWindow + GetWindowThreadProcessId
 * App list: Start Menu .lnk enumeration
 * Window Displays: EnumWindows + GetWindowRect + process matching
 *
 * Note: Windows does not have ScreenCaptureKit's per-app exclusion.
 * Screenshots capture all windows. Privacy filtering is handled at
 * the MCP gate layer.
 */

import { execSync, spawn } from 'child_process'
import * as path from 'path'
import type {
  SwiftBackend,
  DisplayGeometry,
  FrontmostApp,
} from '../types.js'

// ---------------------------------------------------------------------------
// Persistent PowerShell process for low-latency repeated calls
// ---------------------------------------------------------------------------

import type { ChildProcessWithoutNullStreams } from 'child_process'

let psProc: ChildProcessWithoutNullStreams | null = null
let psReady = false
let cmdSeq = 0
const pending = new Map<number, { resolve: (v: string) => void; timer: ReturnType<typeof setTimeout> }>()

function getPs(): ChildProcessWithoutNullStreams {
  if (psProc && !psProc.killed) return psProc

  psProc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', '-',
  ], { windowsHide: true })

  let buf = ''
  psProc.stdout.on('data', (data: Buffer) => {
    buf += data.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!psReady && trimmed === 'CU_PS_READY') {
        psReady = true
        continue
      }
      const match = trimmed.match(/^__CU__(\d+)__(.*)$/)
      if (match) {
        const id = parseInt(match[1], 10)
        const handler = pending.get(id)
        if (handler) {
          pending.delete(id)
          clearTimeout(handler.timer)
          handler.resolve(match[2])
        }
      }
    }
  })

  psProc.stderr.on('data', () => {})
  psProc.on('error', () => { psProc = null; psReady = false })
  psProc.on('close', () => { psProc = null; psReady = false })

  // Init DPI awareness so CopyFromScreen captures at full physical resolution
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
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve('')
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    proc.stdin.write(`${script}; Write-Output "__CU_${id}__done"\n`)
  })
}

function psSync(script: string): string {
  try {
    return execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 10000, windowsHide: true },
    ).trim()
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

let displayCache: DisplayGeometry[] | null = null
let displayCacheTime = 0
const DISPLAY_CACHE_TTL = 5000

// ---------------------------------------------------------------------------
// Display enumeration (with DPI awareness)
// ---------------------------------------------------------------------------

export const displays: SwiftBackend['displays'] = (): DisplayGeometry[] => {
  const now = Date.now()
  if (displayCache && now - displayCacheTime < DISPLAY_CACHE_TTL) return displayCache

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

  if (!out) {
    displayCache = []
    displayCacheTime = now
    return displayCache
  }

  const result = out.split('|').map((line, i) => {
    const parts = line.split(',').map(Number)
    return {
      displayId: i,
      width: parts[2],
      height: parts[3],
      scaleFactor: 1,
      originX: parts[0],
      originY: parts[1],
    }
  })

  displayCache = result
  displayCacheTime = now
  return result
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
// Screenshot
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

  return {
    base64,
    width: w,
    height: h,
    displayWidth: w,
    displayHeight: h,
    originX: ox,
    originY: oy,
    displayId,
  }
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
// Window display mapping (real EnumWindows implementation)
// ---------------------------------------------------------------------------

export const findWindowDisplays: SwiftBackend['findWindowDisplays'] = (opts) => {
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
      try {
        var p = Process.GetProcessById((int)pid);
        var name = p.MainModule != null ? p.MainModule.FileName : p.ProcessName;
        results.Add(name + "|" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom);
      } catch { }
      return true;
    }, IntPtr.Zero);
    return string.Join("\\n", results);
  }
}'
[CuWin]::Enumerate()
`)

  const wins = out ? out.split('\n').filter(Boolean) : []

  return opts.bundleIds.map(bid => {
    const displayIds: number[] = []
    for (const w of wins) {
      const [exePath, rectStr] = w.split('|', 2)
      if (!exePath || !rectStr) continue
      // Match by exe path or process name
      if (exePath.toLowerCase() !== bid.toLowerCase() &&
          !exePath.toLowerCase().endsWith(bid.toLowerCase())) continue

      const [left, top, right, bottom] = rectStr.split(',').map(Number)
      const winCenterX = (left + right) / 2
      const winCenterY = (top + bottom) / 2

      for (const d of displays()) {
        if (winCenterX >= d.originX && winCenterX < d.originX + d.width &&
            winCenterY >= d.originY && winCenterY < d.originY + d.height) {
          if (!displayIds.includes(d.displayId)) displayIds.push(d.displayId)
        }
      }
    }
    return { bundleId: bid, displayIds }
  })
}

// ---------------------------------------------------------------------------
// Frontmost application
// ---------------------------------------------------------------------------

export const frontmostApplication: SwiftBackend['frontmostApplication'] = (): FrontmostApp | null => {
  const out = psSync(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Text;
public class CUFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}'
$hwnd = [CUFg]::GetForegroundWindow()
$pid = [uint32]0
[CUFg]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
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
  const out = await psRun(`
$dirs = @(
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu'),
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
)
$shortcuts = Get-ChildItem -Path $dirs -Filter *.lnk -Recurse -ErrorAction SilentlyContinue
$shell = New-Object -ComObject WScript.Shell
$result = @()
foreach ($s in $shortcuts) {
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
// Permission checks (Windows has no TCC equivalent)
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

export const prepareDisplay: SwiftBackend['prepareDisplay'] = async () => {
  // Windows does not hide apps at the compositor level.
  return { hidden: [], activated: null }
}

export const resolvePrepareCapture: SwiftBackend['resolvePrepareCapture'] = async (opts) => {
  const shot = await screenshot({
    allowedBundleIds: opts.allowedBundleIds,
    displayId: opts.preferredDisplayId,
  })
  if (!shot) return null
  return {
    ...shot,
    hidden: [],
    activated: null,
    displayId: shot.displayId ?? 0,
  }
}

export const notifyExpectedEscape: SwiftBackend['notifyExpectedEscape'] = () => {
  // Windows: could use SetWindowsHookEx for low-level keyboard hook
}

export const unhide: SwiftBackend['unhide'] = () => {}
export const open: SwiftBackend['open'] = (opts) => {
  psSync(`Start-Process -FilePath "${opts.bundleId}"`)
}
export const previewHideSet: SwiftBackend['previewHideSet'] = () => []
export const drainMainRunLoop: SwiftBackend['drainMainRunLoop'] = () => {}
