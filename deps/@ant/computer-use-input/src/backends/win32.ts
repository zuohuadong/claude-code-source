/**
 * Windows (win32) backend for @ant/computer-use-input.
 *
 * Priority chain:
 *   1. @ant/computer-use-native (Rust NAPI — SendInput + MOUSEEVENTF_ABSOLUTE)
 *   2. computer-use-input.node (legacy NAPI build)
 *   3. PowerShell + Win32 P/Invoke fallback
 */

import { execFileSync } from 'child_process'
import path from 'path'
import type { FrontmostAppInfo, InputBackend } from '../types.js'

import type * as Native from '../../computer-use-native/index.js'

// ---------------------------------------------------------------------------
// Try native modules
// ---------------------------------------------------------------------------

let nativeInput: any = null
let nativeExec: typeof Native | null = null

// 1. Try @ant/computer-use-native (full cross-platform native)
try {
  const nativePath =
    process.env.COMPUTER_USE_NATIVE_NODE_PATH ??
    path.resolve(import.meta.dir, '../../../computer-use-native/prebuilds/computer-use-native.node')
  nativeInput = require(nativePath)
  nativeExec = nativeInput
} catch {
  // computer-use-native not available
}

// 2. Try legacy computer-use-input.node
if (!nativeInput) {
  try {
    const legacyPath =
      process.env.COMPUTER_USE_INPUT_NODE_PATH ??
      path.resolve(import.meta.dir, '../../prebuilds/computer-use-input.node')
    nativeInput = require(legacyPath)
  } catch {
    // Legacy addon not available either
  }
}

if (nativeInput && nativeExec?.mouseMove) {
  // ── Full native backend (@ant/computer-use-native) ──
  module.exports = createNativeBackend(nativeExec)
} else if (nativeInput && (nativeInput.moveMouse || nativeInput.move_mouse)) {
  // ── Legacy NAPI backend (computer-use-input.node) ──
  module.exports = {
    moveMouse: nativeInput.moveMouse ?? nativeInput.move_mouse,
    key: nativeInput.key,
    keys: nativeInput.keys,
    typeText: nativeInput.typeText ?? nativeInput.type_text,
    mouseLocation: nativeInput.mouseLocation ?? nativeInput.mouse_location,
    mouseButton: nativeInput.mouseButton ?? nativeInput.mouse_button,
    mouseScroll: nativeInput.mouseScroll ?? nativeInput.mouse_scroll,
    getFrontmostAppInfo: nativeInput.getFrontmostAppInfo ?? nativeInput.get_frontmost_app_info,
  }
} else {
  // ── PowerShell fallback ──
  module.exports = createPowerShellBackend()
}

// ---------------------------------------------------------------------------
// Native backend (@ant/computer-use-native)
// ---------------------------------------------------------------------------

function createNativeBackend(n: typeof Native): InputBackend {
  return {
    async moveMouse(x: number, y: number, _animated?: boolean): Promise<void> {
      n.mouseMove!(x, y)
    },

    async key(keyName: string, action?: 'click' | 'press' | 'release'): Promise<void> {
      const act = action ?? 'click'
      if (act === 'click') {
        n.keyPress!(keyName, 1)
      } else if (act === 'press') {
        // hold_key with 0ms duration acts as press-only
        n.holdKey!([keyName], 0)
      } else {
        // release: keybd_event KEYUP — not directly exposed, approximate via hold+release
        // For reliable press/release on Windows, use the legacy NAPI or PowerShell path.
        // The native module's key_press does click (down+up), so for pure release
        // we fall through to PowerShell for this rare operation.
        psReleaseKey(keyName)
      }
    },

    async keys(parts: string[]): Promise<void> {
      // key_press accepts a combo string like "ctrl+c"
      n.keyPress!(parts.join('+'), 1)
    },

    async typeText(text: string): Promise<void> {
      n.typeText!(text)
    },

    async mouseLocation(): Promise<{ x: number; y: number }> {
      return n.cursorPosition!()
    },

    async mouseButton(
      button: 'left' | 'right' | 'middle',
      action: 'click' | 'press' | 'release',
      count?: number,
    ): Promise<void> {
      if (action === 'click') {
        // mouse_click takes absolute coordinates — we need cursor position first
        const pos = n.cursorPosition!()
        n.mouseClick!(pos.x, pos.y, button, count ?? 1)
      } else {
        // mouse_button does press/release at current position
        n.mouseButton!(action, 0, 0)
      }
    },

    async mouseScroll(
      amount: number,
      direction: 'vertical' | 'horizontal',
    ): Promise<void> {
      // zavora mouse_scroll(dy, dx) — vertical = dy, horizontal = dx
      if (direction === 'vertical') {
        n.mouseScroll!(amount, 0)
      } else {
        n.mouseScroll!(0, amount)
      }
    },

    getFrontmostAppInfo(): FrontmostAppInfo | null {
      const app = n.getFrontmostApp?.()
      if (!app) return null
      return {
        bundleId: app.bundleId ?? '',
        appName: app.displayName ?? app.bundleId ?? '',
      }
    },
  }
}

// ---------------------------------------------------------------------------
// PowerShell helpers (used for edge-case operations not in native module)
// ---------------------------------------------------------------------------

const POWERSHELL = 'powershell.exe'

const VK_MAP: Record<string, number> = {
  return: 0x0d, enter: 0x0d, tab: 0x09, space: 0x20,
  backspace: 0x08, delete: 0x2e, escape: 0x1b, esc: 0x1b,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  shift: 0xa0, control: 0xa2, ctrl: 0xa2, alt: 0xa4, option: 0xa4,
  win: 0x5b, meta: 0x5b, command: 0x5b, cmd: 0x5b,
}

function ps(script: string): void {
  execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
    stdio: 'pipe',
  })
}

function psReleaseKey(keyName: string): void {
  const lower = keyName.toLowerCase()
  const vk = VK_MAP[lower]
  if (vk === undefined) return
  ps(
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)`,
  )
}

// ---------------------------------------------------------------------------
// PowerShell fallback backend
// ---------------------------------------------------------------------------

function createPowerShellBackend(): InputBackend {
  return {
    async moveMouse(x: number, y: number): Promise<void> {
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; [W]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
      )
    },

    async key(keyName: string, action: 'press' | 'release' | 'click' = 'click'): Promise<void> {
      const lower = keyName.toLowerCase()
      const vk = VK_MAP[lower]
      if (vk === undefined) return
      const flags = action === 'release' ? '2' : '0'
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(${vk}, 0, ${flags}, [UIntPtr]::Zero)`,
      )
      if (action === 'click') {
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)`,
        )
      }
    },

    async keys(parts: string[]): Promise<void> {
      const combo = parts.join('+')
      // Use PowerShell for chord
      const modifiers: number[] = []
      let finalKey: string | null = null
      for (const part of parts) {
        const vk = VK_MAP[part.toLowerCase()]
        if (vk !== undefined && part.toLowerCase().match(/shift|control|ctrl|alt|option|win|meta|command|cmd/)) {
          modifiers.push(vk)
        } else {
          finalKey = part
        }
      }
      if (!finalKey) return
      let script = ''
      for (const vk of modifiers) {
        script += `[W]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); `
      }
      const finalVk = VK_MAP[finalKey.toLowerCase()]
      if (finalVk !== undefined) {
        script += `[W]::keybd_event(${finalVk}, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(${finalVk}, 0, 2, [UIntPtr]::Zero); `
      }
      for (let i = modifiers.length - 1; i >= 0; i--) {
        script += `[W]::keybd_event(${modifiers[i]}, 0, 2, [UIntPtr]::Zero); `
      }
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; ${script}`,
      )
    },

    async typeText(text: string): Promise<void> {
      for (const ch of [...text]) {
        const code = ch.codePointAt(0)!
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(0, ${code}, 4, [UIntPtr]::Zero); [W]::keybd_event(0, ${code}, 6, [UIntPtr]::Zero)`,
        )
      }
    },

    async mouseLocation(): Promise<{ x: number; y: number }> {
      const out = execFileSync(
        POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-Command',
         `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); }'; $p = New-Object W+P; [W]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`],
        { encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: 'pipe' },
      ).trim()
      const [xStr, yStr] = out.split(',')
      return { x: Number(xStr), y: Number(yStr) }
    },

    async mouseButton(
      button: 'left' | 'right' | 'middle',
      action: 'click' | 'press' | 'release',
      count?: number,
    ): Promise<void> {
      const down = button === 'left' ? '2' : button === 'right' ? '8' : '32'
      const up = button === 'left' ? '4' : button === 'right' ? '16' : '64'
      if (action === 'click') {
        const n = count ?? 1
        let clickScript = ''
        for (let i = 0; i < n; i++) {
          clickScript += `[W]::mouse_event(${down}, 0, 0, 0, 0); [W]::mouse_event(${up}, 0, 0, 0, 0); `
        }
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; ${clickScript}`,
        )
      } else {
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; [W]::mouse_event(${action === 'press' ? down : up}, 0, 0, 0, 0)`,
        )
      }
    },

    async mouseScroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void> {
      const flag = direction === 'horizontal' ? '0x1000' : '0x0800'
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; [W]::mouse_event(${flag}, 0, 0, ${amount * 120}, 0)`,
      )
    },

    getFrontmostAppInfo(): FrontmostAppInfo | null {
      try {
        const out = execFileSync(
          POWERSHELL,
          ['-NoProfile', '-NonInteractive', '-Command',
           `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $h = [W]::GetForegroundWindow(); $pid = [uint32]0; [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; $p = Get-Process -Id $pid -ErrorAction SilentlyContinue; "$($p.MainModule.FileName)|$($p.ProcessName)"`],
          { encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: 'pipe' },
        ).trim()
        if (!out || !out.includes('|')) return null
        const [exePath, appName] = out.split('|', 2)
        return { bundleId: exePath, appName } as FrontmostAppInfo
      } catch {
        return null
      }
    },
  }
}
