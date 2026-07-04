/**
 * Windows (win32) backend for @ant/computer-use-input.
 *
 * Tries to load the native Rust NAPI addon first (computer-use-input.node).
 * If unavailable, falls back to a PowerShell + Win32 P/Invoke implementation.
 *
 * The native addon uses the `windows` crate directly (SendInput, SetCursorPos,
 * GetCursorPos, GetForegroundWindow, GetAsyncKeyState) — no PowerShell overhead.
 */

import { execFileSync } from 'child_process'
import path from 'path'
import type { FrontmostAppInfo, InputBackend } from '../types.js'

// ---------------------------------------------------------------------------
// Try native .node first
// ---------------------------------------------------------------------------

let native: any = null
try {
  const nativePath =
    process.env.COMPUTER_USE_INPUT_NODE_PATH ??
    path.resolve(import.meta.dir, '../../prebuilds/computer-use-input.node')
  native = require(nativePath)
} catch {
  // Native addon not available — fall through to PowerShell fallback.
}

if (native && native.isSupported !== false) {
  // Native addon loaded successfully — re-export its functions.
  // The NAPI layer exports the same API on both macOS and Windows.
  module.exports = {
    moveMouse: native.moveMouse ?? native.move_mouse,
    key: native.key,
    keys: native.keys,
    typeText: native.typeText ?? native.type_text,
    mouseLocation: native.mouseLocation ?? native.mouse_location,
    mouseButton: native.mouseButton ?? native.mouse_button,
    mouseScroll: native.mouseScroll ?? native.mouse_scroll,
    getFrontmostAppInfo: native.getFrontmostAppInfo ?? native.get_frontmost_app_info,
  }
} else {
  module.exports = createPowerShellBackend()
}

// ---------------------------------------------------------------------------
// PowerShell fallback (used when .node is not yet compiled for win32)
// ---------------------------------------------------------------------------

const POWERSHELL = 'powershell.exe'

const VK_MAP: Record<string, number> = {
  return: 0x0d, enter: 0x0d, tab: 0x09, space: 0x20,
  backspace: 0x08, delete: 0x2e, escape: 0x1b, esc: 0x1b,
  left: 0x25, leftarrow: 0x25, up: 0x26, uparrow: 0x26,
  right: 0x27, rightarrow: 0x27, down: 0x28, downarrow: 0x28,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
  f13: 0x7c, f14: 0x7d, f15: 0x7e, f16: 0x7f, f17: 0x80,
  f18: 0x81, f19: 0x82, f20: 0x83,
  shift: 0xa0, lshift: 0xa0, rshift: 0xa1,
  control: 0xa2, ctrl: 0xa2, lcontrol: 0xa2, rcontrol: 0xa3,
  alt: 0xa4, option: 0xa4, lalt: 0xa4, ralt: 0xa5,
  win: 0x5b, windows: 0x5b, meta: 0x5b, command: 0x5b, cmd: 0x5b, super: 0x5b,
  insert: 0x2d, printscreen: 0x2c, pause: 0x13,
  numlock: 0x90, capslock: 0x14, scrolllock: 0x91,
  numpad0: 0x60, numpad1: 0x61, numpad2: 0x62, numpad3: 0x63,
  numpad4: 0x64, numpad5: 0x65, numpad6: 0x66, numpad7: 0x67,
  numpad8: 0x68, numpad9: 0x69,
  decimal: 0x6e, divide: 0x6f, multiply: 0x6a, subtract: 0x6d, add: 0x6b,
}

const MODIFIER_KEYS = new Set([
  'shift', 'lshift', 'rshift', 'control', 'ctrl', 'lcontrol', 'rcontrol',
  'alt', 'option', 'lalt', 'ralt', 'win', 'meta', 'command', 'cmd', 'super',
])

function ps(script: string): void {
  execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
    stdio: 'pipe',
  })
}

function psCapture(script: string): string {
  return execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
    stdio: 'pipe',
  }).trim()
}

function createPowerShellBackend(): InputBackend {
  return {
    async moveMouse(x: number, y: number): Promise<void> {
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; [W]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
      )
    },

    async key(keyName: string, action: 'press' | 'release'): Promise<void> {
      const lower = keyName.toLowerCase()
      const vk = VK_MAP[lower]
      const flags = action === 'release' ? '2' : '0'
      if (vk !== undefined) {
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(${vk}, 0, ${flags}, [UIntPtr]::Zero)`,
        )
      } else if (keyName.length === 1) {
        const code = keyName.charCodeAt(0)
        const upFlag = action === 'release' ? ' -bor 2' : ''
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'; [W]::keybd_event(0, ${code}, 4${upFlag}, [UIntPtr]::Zero)`,
        )
      }
    },

    async keys(parts: string[]): Promise<void> {
      const modifiers: number[] = []
      let finalKey: string | null = null
      for (const part of parts) {
        if (MODIFIER_KEYS.has(part.toLowerCase())) {
          const vk = VK_MAP[part.toLowerCase()]
          if (vk !== undefined) modifiers.push(vk)
        } else {
          finalKey = part
        }
      }
      if (!finalKey) return

      let script = ''
      for (const vk of modifiers) {
        script += `[W]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); `
      }
      const lower = finalKey.toLowerCase()
      const vk = VK_MAP[lower]
      if (vk !== undefined) {
        script += `[W]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero); `
      } else if (finalKey.length === 1) {
        const code = finalKey.charCodeAt(0)
        script += `[W]::keybd_event(0, ${code}, 4, [UIntPtr]::Zero); [W]::keybd_event(0, ${code}, 6, [UIntPtr]::Zero); `
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
      const out = psCapture(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); }'; $p = New-Object W+P; [W]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`,
      )
      const [xStr, yStr] = out.split(',')
      return { x: Number(xStr), y: Number(yStr) }
    },

    async mouseButton(
      button: 'left' | 'right' | 'middle',
      action: 'click' | 'press' | 'release',
      count?: number,
    ): Promise<void> {
      const down =
        button === 'left' ? '2' : button === 'right' ? '8' : '32'
      const up = button === 'left' ? '4' : button === 'right' ? '16' : '64'
      let flags: string
      if (action === 'press') flags = down
      else if (action === 'release') flags = up
      else {
        // click = down then up, repeated count times
        const n = count ?? 1
        let clickScript = ''
        for (let i = 0; i < n; i++) {
          clickScript += `[W]::mouse_event(${down}, 0, 0, 0, 0); [W]::mouse_event(${up}, 0, 0, 0, 0); `
        }
        ps(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; ${clickScript}`,
        )
        return
      }
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; [W]::mouse_event(${flags}, 0, 0, 0, 0)`,
      )
    },

    async mouseScroll(
      amount: number,
      direction: 'vertical' | 'horizontal',
    ): Promise<void> {
      const flag = direction === 'horizontal' ? '0x1000' : '0x0800'
      ps(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); }'; [W]::mouse_event(${flag}, 0, 0, ${amount * 120}, 0)`,
      )
    },

    getFrontmostAppInfo(): FrontmostAppInfo | null {
      try {
        const out = psCapture(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Text; public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $h = [W]::GetForegroundWindow(); $pid = [uint32]0; [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; $p = Get-Process -Id $pid -ErrorAction SilentlyContinue; "$($p.MainModule.FileName)|$($p.ProcessName)"`,
        )
        if (!out || !out.includes('|')) return null
        const [exePath, appName] = out.split('|', 2)
        return { bundleId: exePath, appName } as FrontmostAppInfo
      } catch {
        return null
      }
    },
  }
}
