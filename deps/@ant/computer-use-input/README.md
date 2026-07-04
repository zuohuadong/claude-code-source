# @ant/computer-use-input

NAPI-RS keyboard/mouse input backend for Computer Use.

## Architecture

```
Node.js / Bun
  -> js/index.js (platform detection + native loader)
  -> src/index.ts (cross-platform loader)
     -> src/backends/darwin.ts (native .node addon)
     -> src/backends/win32.ts (PowerShell + Win32 P/Invoke)
```

### Native addon (Rust)

The `prebuilds/computer-use-input.node` binary is a Rust NAPI-RS addon
that uses [enigo](https://crates.io/crates/enigo) 0.6 for keyboard/mouse
simulation on macOS. All input operations are dispatched to
`DispatchQueue.main` via `dispatch2`, because enigo's macOS backend
(CGEventPost) requires main-thread execution.

Source: `src/lib.rs` + `src/enigo_wrap.rs`

### Windows backend

The win32 backend uses a persistent PowerShell process with pre-compiled
Win32 P/Invoke types (`SetCursorPos`, `SendInput`, `keybd_event`,
`GetForegroundWindow`). This avoids the per-call process spawn overhead
of the haking-code- POC.

## Exported API

8 functions matching the original binary:

| Function | Parameters | Description |
|---|---|---|
| `key` | `(key: string)` | Press/click a single key |
| `keys` | `(key: string)` | Press a key chord (e.g. "cmd+c") |
| `typeText` | `(text: string)` | Type text via keyboard |
| `moveMouse` | `(x, y, animated?)` | Move cursor to position |
| `mouseButton` | `(button, action, count?)` | Mouse button action |
| `mouseScroll` | `(amount, direction)` | Scroll mouse wheel |
| `mouseLocation` | `() -> {x, y}` | Get cursor position |
| `pressedMouseButtons` | `() -> number` | Bitmask of pressed buttons |

## Building from source (macOS)

```bash
cd src/
cargo build --release
# Output: target/release/libcomputer_use_input.dylib -> rename to .node
```

## Key mapping

The full enigo Key enum is supported: Alt, Backspace, BrightnessDown/Up,
Command, ContrastUp/Down, Control, Decimal, Delete, Divide, DownArrow,
Eject, End, Escape, F1-F20, IlluminationUp/Toggle, Launchpad,
LaunchPanel, LeftArrow, LShift, Media*, MissionControl, Numpad0-9,
Option, PageUp, Power, Return, RightArrow, ROption, RShift, Shift,
Space, Super, Tab, UpArrow, VidMirror, VolumeDown/Mute/Up, Windows.
