# @ant/computer-use-input

Cross-platform NAPI-RS keyboard/mouse input backend for Computer Use.

## Architecture

```
Node.js / Bun
  -> src/index.ts (platform detection)
     -> src/backends/darwin.ts (native .node: Rust + enigo + dispatch2)
     -> src/backends/win32.ts (native .node: Rust + enigo + windows crate,
                                or PowerShell fallback if .node not compiled)
```

### Native addon (Rust, cross-platform)

The `prebuilds/computer-use-input.node` binary is a Rust NAPI-RS addon
using [enigo](https://crates.io/crates/enigo) 0.6 for keyboard/mouse
simulation.

Platform backends in `src/platform/`:

| Platform | Backend | Key APIs |
|---|---|---|
| macOS | `platform/macos.rs` | enigo (CGEventPost) + dispatch2 (main thread) + CoreGraphics |
| Windows | `platform/win32.rs` | enigo (SendInput, thread-safe) + `windows` crate (GetCursorPos, GetAsyncKeyState, GetForegroundWindow) |

On macOS, all enigo operations dispatch to `DispatchQueue.main` via
`dispatch2` because CGEventPost requires main-thread execution.
On Windows, `SendInput` is thread-safe, so calls go direct.

Source: `src/lib.rs` + `src/enigo_wrap.rs` + `src/platform/`

### Windows PowerShell fallback

If the native `.node` is not compiled for win32, `src/backends/win32.ts`
falls back to a PowerShell + Win32 P/Invoke implementation using
`SetCursorPos`, `keybd_event`, `mouse_event`, `GetForegroundWindow`.

## Exported API

| Function | Parameters | Description |
|---|---|---|
| `key` | `(key: string, action?: string)` | Press/release/click a key |
| `keys` | `(key: string)` | Press a key chord (e.g. "cmd+c") |
| `typeText` | `(text: string)` | Type text via keyboard |
| `moveMouse` | `(x, y, animated?)` | Move cursor to position |
| `mouseButton` | `(button, action, count?)` | Mouse button action |
| `mouseScroll` | `(amount, direction)` | Scroll mouse wheel |
| `mouseLocation` | `() -> {x, y}` | Get cursor position |
| `pressedMouseButtons` | `() -> number` | Bitmask of pressed buttons |
| `getFrontmostAppInfo` | `() -> {bundleId, appName}` | Frontmost app info |

## Building from source

```bash
# macOS
cargo build --release
# Output: target/release/libcomputer_use_input.dylib -> rename to .node

# Windows (cross-compile or native)
cargo build --release --target x86_64-pc-windows-msvc
# Output: target/release/computer_use_input.dll -> rename to .node
```
