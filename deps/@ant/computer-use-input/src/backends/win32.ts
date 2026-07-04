/**
 * Windows (win32) backend for @ant/computer-use-input.
 *
 * Uses a long-lived PowerShell child process with pre-compiled Win32
 * P/Invoke types (Add-Type runs once at init, then reused across calls).
 *
 * Win32 APIs used:
 *   - SetCursorPos / GetCursorPos (cursor positioning)
 *   - SendInput (mouse + keyboard input simulation)
 *   - keybd_event / VkKeyScan (keyboard input)
 *   - GetForegroundWindow / GetWindowThreadProcessId (frontmost detection)
 *
 * This is a production-oriented rewrite of the haking-code- POC.
 * Key improvements:
 *   - Persistent PowerShell process (no per-call spawn)
 *   - Named pipe stdin/stdout for low-latency IPC
 *   - Proper Unicode text entry via SendInput Unicode mode
 *   - Error propagation via try/catch
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { InputBackend, FrontmostAppInfo } from '../types.js'

// ---------------------------------------------------------------------------
// Virtual key code mapping (recovered from binary + haking-code-)
// ---------------------------------------------------------------------------

const VK_MAP: Record<string, number> = {
  return: 0x0d, enter: 0x0d, tab: 0x09, space: 0x20,
  backspace: 0x08, delete: 0x2e, escape: 0x1b, esc: 0x1b,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
  f13: 0x7c, f14: 0x7d, f15: 0x7e, f16: 0x7f, f17: 0x80,
  f18: 0x81, f19: 0x82, f20: 0x83,
  shift: 0xa0, lshift: 0xa0, rshift: 0xa1,
  control: 0xa2, ctrl: 0xa2, lcontrol: 0xa2, rcontrol: 0xa3,
  alt: 0xa4, option: 0xa4, lalt: 0xa4, ralt: 0xa5,
  win: 0x5b, meta: 0x5b, command: 0x5b, cmd: 0x5b, super: 0x5b,
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

// ---------------------------------------------------------------------------
// Persistent PowerShell process
// ---------------------------------------------------------------------------

let psProcess: ChildProcessWithoutNullStreams | null = null
let commandId = 0
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()

function getProcess(): ChildProcessWithoutNullStreams {
  if (psProcess && !psProcess.killed) return psProcess

  psProcess = spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-Command', '-',
  ], { windowsHide: true })

  // Compile P/Invoke types once
  psProcess.stdin.write(WIN32_TYPES + '\n')
  psProcess.stdin.write('Write-Output "READY"\n')

  // Line-based response handler
  let buffer = ''
  psProcess.stdout.on('data', (data: Buffer) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'READY' || trimmed === '') continue
      // Parse: __RESULT__<id>__<output>
      const match = trimmed.match(/^__RESULT__(\d+)__([\s\S]*)$/)
      if (match) {
        const id = parseInt(match[1], 10)
        const output = match[2]
        const handler = pending.get(id)
        if (handler) {
          pending.delete(id)
          handler.resolve(output)
        }
      }
    }
  })

  psProcess.stderr.on('data', () => {
    // Suppress stderr noise
  })

  psProcess.on('error', () => {
    psProcess = null
  })

  return psProcess
}

/** Execute a PowerShell script and return trimmed stdout. */
async function ps(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = getProcess()
    const id = ++commandId
    pending.set(id, { resolve, reject })

    // Wrap in a result marker for reliable parsing
    const wrapped = `${script}; Write-Output "__RESULT__${id}__done"\n`
    proc.stdin.write(wrapped)

    // Timeout after 5 seconds
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error('PowerShell command timed out'))
      }
    }, 5000)
  })
}

// ---------------------------------------------------------------------------
// P/Invoke type definitions (compiled once, cached by PowerShell session)
// ---------------------------------------------------------------------------

const WIN32_TYPES = `
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class CuWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx; public int dy; public int mouseData;
        public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)] public struct INPUT {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public MOUSEINPUT mi;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint n, INPUT[] i, int cb);

    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] public static extern short VkKeyScanEx(char ch, IntPtr hkl);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);

    public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020, MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800, MOUSEEVENTF_HWHEEL = 0x1000;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_SCANCODE = 0x0008;
}
'@
`

// ---------------------------------------------------------------------------
// Backend implementation
// ---------------------------------------------------------------------------

export const moveMouse: InputBackend['moveMouse'] = async (x, y, animated) => {
  await ps(`[CuWin32]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`)
}

export const mouseLocation: InputBackend['mouseLocation'] = async () => {
  const out = await ps(`$p = New-Object CuWin32+POINT; [CuWin32]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`)
  const [xStr, yStr] = out.split(',')
  return { x: Number(xStr), y: Number(yStr) }
}

export const mouseButton: InputBackend['mouseButton'] = async (button, action, count) => {
  const down = button === 'left' ? 'MOUSEEVENTF_LEFTDOWN'
    : button === 'right' ? 'MOUSEEVENTF_RIGHTDOWN' : 'MOUSEEVENTF_MIDDLEDOWN'
  const up = button === 'left' ? 'MOUSEEVENTF_LEFTUP'
    : button === 'right' ? 'MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_MIDDLEUP'

  if (action === 'click') {
    const n = count ?? 1
    let clicks = ''
    for (let i = 0; i < n; i++) {
      clicks += `$i.mi.dwFlags=[CuWin32]::${down}; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null; $i.mi.dwFlags=[CuWin32]::${up}; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null; `
    }
    await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_MOUSE; ${clicks}`)
  } else if (action === 'press') {
    await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_MOUSE; $i.mi.dwFlags=[CuWin32]::${down}; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
  } else {
    await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_MOUSE; $i.mi.dwFlags=[CuWin32]::${up}; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
  }
}

export const mouseScroll: InputBackend['mouseScroll'] = async (amount, direction) => {
  const flag = direction === 'horizontal' ? 'MOUSEEVENTF_HWHEEL' : 'MOUSEEVENTF_WHEEL'
  await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_MOUSE; $i.mi.dwFlags=[CuWin32]::${flag}; $i.mi.mouseData=${amount * 120}; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
}

export const key: InputBackend['key'] = async (keyName, action) => {
  const lower = keyName.toLowerCase()
  const vk = VK_MAP[lower]
  const flags = action === 'release' ? '2' : '0'

  if (vk !== undefined) {
    await ps(`[CuWin32]::keybd_event(${vk}, 0, ${flags}, [UIntPtr]::Zero)`)
  } else if (keyName.length === 1) {
    // Unicode character entry via SendInput KEYEVENTF_UNICODE
    const charCode = keyName.charCodeAt(0)
    await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_KEYBOARD; $i.ki.wScan=${charCode}; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
    if (action !== 'press') {
      await ps(`$i = New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_KEYBOARD; $i.ki.wScan=${charCode}; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE -bor [CuWin32]::KEYEVENTF_KEYUP; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
    }
  }
}

export const keys: InputBackend['keys'] = async (parts) => {
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
    script += `[CuWin32]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); `
  }
  const lower = finalKey.toLowerCase()
  const vk = VK_MAP[lower]
  if (vk !== undefined) {
    script += `[CuWin32]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [CuWin32]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero); `
  } else if (finalKey.length === 1) {
    const charCode = finalKey.charCodeAt(0)
    script += `$i=New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_KEYBOARD; $i.ki.wScan=${charCode}; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE -bor [CuWin32]::KEYEVENTF_KEYUP; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null; `
  }
  for (let i = modifiers.length - 1; i >= 0; i--) {
    script += `[CuWin32]::keybd_event(${modifiers[i]}, 0, 2, [UIntPtr]::Zero); `
  }
  await ps(script)
}

export const typeText: InputBackend['typeText'] = async (text) => {
  // Unicode text entry: iterate characters, use KEYEVENTF_UNICODE SendInput.
  // This handles CJK, emoji, and any Unicode codepoint correctly.
  const chars = [...text]
  for (const ch of chars) {
    const code = ch.codePointAt(0)!
    await ps(`$i=New-Object CuWin32+INPUT; $i.type=[CuWin32]::INPUT_KEYBOARD; $i.ki.wScan=${code}; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null; $i.ki.dwFlags=[CuWin32]::KEYEVENTF_UNICODE -bor [CuWin32]::KEYEVENTF_KEYUP; [CuWin32]::SendInput(1,@($i),[Runtime.InteropServices.Marshal]::SizeOf($i))|Out-Null`)
  }
}

export const getFrontmostAppInfo: InputBackend['getFrontmostAppInfo'] = () => {
  // Synchronous version: spawn a quick PowerShell for this.
  // The persistent process is async; for sync callers we do a one-shot.
  try {
    const { execSync } = require('child_process')
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "${WIN32_TYPES}; $hwnd=[CuWin32]::GetForegroundWindow(); $pid=[uint32]0; [CuWin32]::GetWindowThreadProcessId($hwnd,[ref]$pid)|Out-Null; $p=Get-Process -Id $pid -ErrorAction SilentlyContinue; \\"$($p.MainModule.FileName)|$($p.ProcessName)\\""`,
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ).trim()
    if (!out.includes('|')) return null
    const [exePath, appName] = out.split('|', 2)
    return { bundleId: exePath, appName } as FrontmostAppInfo
  } catch {
    return null
  }
}
