# @ant/computer-use-native

Cross-platform native NAPI-RS module for computer-use operations.

Vendored from [zavora-ai/computer-use-mcp](https://github.com/zavora-ai/computer-use-mcp).

## Capabilities

### Mouse
- `mouse_move(x, y)` — absolute move with 0-65535 normalization (Windows)
- `mouse_click(x, y, button, count)` — click at coordinates
- `mouse_button(action, x, y)` — press/release at coordinates
- `mouse_scroll(dy, dx)` — vertical + horizontal scroll
- `mouse_drag(x, y)` — drag move
- `cursor_position()` — get current cursor position

### Keyboard
- `key_press(combo, repeat?)` — press key combo (e.g. "ctrl+c")
- `type_text(text)` — type Unicode text via KEYEVENTF_UNICODE (Windows)
- `hold_key(keys, duration_ms)` — hold keys for duration

### Screenshot
- `take_screenshot(width?, target_app?, quality?, previous_hash?, window_id?)` — capture screen
  - Windows: DXGI Desktop Duplication with GDI BitBlt fallback
  - macOS: CGWindowListCreateImage
  - Linux: X11 XGetImage
- `annotate_image(...)` — draw rectangles + grid on image
- `crop_image(...)` — crop region from image

### Display
- `get_display_size(display_id?)` — get display dimensions + DPI
- `list_displays()` — enumerate all monitors

### Apps
- `get_frontmost_app()` — get foreground application
- `activate_app(bundle_id, timeout_ms?)` — bring app to front
- `list_running_apps()` — list running apps with visible windows
- `hide_app(bundle_id)` — minimize app windows
- `unhide_app(bundle_id)` — restore app windows
- `prepare_display(target, keep_visible)` — minimize all except target

### Windows
- `list_windows(bundle_id?)` — enumerate top-level windows
- `get_window(window_id)` — get window info
- `get_cursor_window()` — get window under cursor
- `activate_window(window_id, timeout_ms?)` — bring window to front

### Clipboard
- `read_clipboard()` — read text from clipboard
- `write_clipboard(text)` — write text to clipboard

## Build

```bash
cargo build --release
```

Produces `computer-use-native.node` (`.dylib` on macOS, `.dll` on Windows, `.so` on Linux).

## Platform Matrix

| Platform | Mouse | Keyboard | Screenshot | Display | Apps | Windows | Clipboard |
|----------|-------|----------|------------|---------|------|---------|-----------|
| macOS    | CGEvent | CGEvent | CGWindowList | CGDirectDisplay | NSWorkspace | NSWindow | NSPasteboard |
| Windows  | SendInput | SendInput + UNICODE | DXGI + GDI | EnumDisplayMonitors | EnumWindows | EnumWindows | OpenClipboard |
| Linux    | X11/XTest | X11/XTest | XGetImage | XRandR | _/proc_ | _NET_WM | xclip |
