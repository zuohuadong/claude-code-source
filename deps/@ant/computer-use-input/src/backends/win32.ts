import { execFileSync } from 'child_process'
import type { FrontmostAppInfo, InputBackend } from '../types.js'

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

const MODIFIERS = new Set([
  'shift', 'lshift', 'rshift',
  'control', 'ctrl', 'lcontrol', 'rcontrol',
  'alt', 'option', 'lalt', 'ralt',
  'win', 'windows', 'meta', 'command', 'cmd', 'super',
])

const WIN32_TYPES = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;

public class CuWin32Input {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public MOUSEINPUT mi;
    [FieldOffset(8)] public KEYBDINPUT ki;
  }

  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll", SetLastError=true)] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint MOUSEEVENTF_HWHEEL = 0x1000;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
}
'@
`

function ps(script: string, timeout = 5000): string {
  return execFileSync(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${WIN32_TYPES}\n${script}`],
    { encoding: 'utf8', timeout, windowsHide: true },
  ).trim()
}

function sendMouse(flags: string, mouseData = 0): void {
  ps(`$i = New-Object CuWin32Input+INPUT
$i.type = [CuWin32Input]::INPUT_MOUSE
$i.mi.dwFlags = [CuWin32Input]::${flags}
$i.mi.mouseData = ${mouseData}
$sent = [CuWin32Input]::SendInput(1, @($i), [Runtime.InteropServices.Marshal]::SizeOf([CuWin32Input+INPUT]))
if ($sent -ne 1) { throw "SendInput mouse failed" }`)
}

function sendUnicodeUnit(codeUnit: number, keyUp: boolean): void {
  const flags = keyUp
    ? '[CuWin32Input]::KEYEVENTF_UNICODE -bor [CuWin32Input]::KEYEVENTF_KEYUP'
    : '[CuWin32Input]::KEYEVENTF_UNICODE'
  ps(`$i = New-Object CuWin32Input+INPUT
$i.type = [CuWin32Input]::INPUT_KEYBOARD
$i.ki.wScan = ${codeUnit}
$i.ki.dwFlags = ${flags}
$sent = [CuWin32Input]::SendInput(1, @($i), [Runtime.InteropServices.Marshal]::SizeOf([CuWin32Input+INPUT]))
if ($sent -ne 1) { throw "SendInput keyboard failed" }`)
}

function keyDown(vk: number): void {
  ps(`[CuWin32Input]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)`)
}

function keyUp(vk: number): void {
  ps(`[CuWin32Input]::keybd_event(${vk}, 0, [CuWin32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)`)
}

export const moveMouse: InputBackend['moveMouse'] = async (x, y) => {
  ps(`if (-not [CuWin32Input]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})) { throw "SetCursorPos failed" }`)
}

export const mouseLocation: InputBackend['mouseLocation'] = async () => {
  const out = ps(`$p = New-Object CuWin32Input+POINT
if (-not [CuWin32Input]::GetCursorPos([ref]$p)) { throw "GetCursorPos failed" }
"$($p.X),$($p.Y)"`)
  const [x, y] = out.split(',').map(Number)
  return { x, y }
}

export const mouseButton: InputBackend['mouseButton'] = async (button, action = 'click', count = 1) => {
  const names: Record<string, [string, string]> = {
    left: ['MOUSEEVENTF_LEFTDOWN', 'MOUSEEVENTF_LEFTUP'],
    right: ['MOUSEEVENTF_RIGHTDOWN', 'MOUSEEVENTF_RIGHTUP'],
    middle: ['MOUSEEVENTF_MIDDLEDOWN', 'MOUSEEVENTF_MIDDLEUP'],
  }
  const pair = names[String(button).toLowerCase()]
  if (!pair) throw new Error(`Invalid button name: ${button}`)
  const [down, up] = pair
  if (action === 'press') return sendMouse(down)
  if (action === 'release') return sendMouse(up)
  for (let i = 0; i < Math.max(1, count); i++) {
    sendMouse(down)
    sendMouse(up)
  }
}

export const mouseScroll: InputBackend['mouseScroll'] = async (amount, direction = 'vertical') => {
  const flag = direction === 'horizontal' ? 'MOUSEEVENTF_HWHEEL' : 'MOUSEEVENTF_WHEEL'
  sendMouse(flag, Math.trunc(amount * 120))
}

export const key: InputBackend['key'] = async (keyName, action = 'click') => {
  const vk = VK_MAP[String(keyName).toLowerCase()]
  if (vk !== undefined) {
    if (action === 'press') return keyDown(vk)
    if (action === 'release') return keyUp(vk)
    keyDown(vk)
    keyUp(vk)
    return
  }

  const text = String(keyName)
  if ([...text].length !== 1) throw new Error(`Invalid key name: ${keyName}`)
  if (action === 'release') {
    for (let i = text.length - 1; i >= 0; i--) sendUnicodeUnit(text.charCodeAt(i), true)
    return
  }
  for (let i = 0; i < text.length; i++) sendUnicodeUnit(text.charCodeAt(i), false)
  if (action !== 'press') {
    for (let i = text.length - 1; i >= 0; i--) sendUnicodeUnit(text.charCodeAt(i), true)
  }
}

export const keys: InputBackend['keys'] = async (parts) => {
  const modifiers: string[] = []
  let finalKey: string | undefined
  for (const part of parts) {
    const lower = String(part).toLowerCase()
    if (MODIFIERS.has(lower)) modifiers.push(part)
    else finalKey = part
  }
  if (finalKey === undefined) throw new Error('No keys provided')
  for (const mod of modifiers) await key(mod, 'press')
  try {
    await key(finalKey, 'click')
  } finally {
    for (let i = modifiers.length - 1; i >= 0; i--) await key(modifiers[i]!, 'release')
  }
}

export const typeText: InputBackend['typeText'] = async (text) => {
  for (let i = 0; i < String(text).length; i++) {
    const code = String(text).charCodeAt(i)
    sendUnicodeUnit(code, false)
    sendUnicodeUnit(code, true)
  }
}

export const getFrontmostAppInfo: InputBackend['getFrontmostAppInfo'] = () => {
  try {
    const out = ps(`$hwnd = [CuWin32Input]::GetForegroundWindow()
$pid = [uint32]0
[CuWin32Input]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$p = Get-Process -Id $pid -ErrorAction Stop
"$($p.MainModule.FileName)|$($p.ProcessName)"`, 3000)
    const [bundleId, appName] = out.split('|', 2)
    return bundleId && appName ? { bundleId, appName } as FrontmostAppInfo : null
  } catch {
    return null
  }
}
