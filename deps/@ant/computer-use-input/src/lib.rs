//! NAPI-RS entry point for @ant/computer-use-input.
//!
//! Original source: claude-native/src/input/enigo_wrap.rs
//! Build path: packages/desktop/computer-use-input/
//!
//! All input operations are dispatched to the macOS main thread via
//! dispatch2, because enigo's macOS backend (CGEventPost) requires it.
//! Under Electron, CFRunLoop drains DispatchQueue.main automatically.
//! Under Node/Bun (libuv), consumers must pump the main run loop.

mod enigo_wrap;

use napi_derive::napi;
use napi::bindgen_prelude::*;

/// Press, release, or click a single key.
///
/// Recovers from binary: `key(key: <key>)` debug log, supports the full
/// enigo Key enum (F1-F20, modifiers, arrows, etc).
#[napi]
pub async fn key(key: String, action: Option<String>) -> Result<()> {
    let action = action.unwrap_or_else(|| "click".to_string());
    enigo_wrap::key_action(&key, &action)
        .map_err(|e| Error::from_reason(e))
}

/// Press a key chord (e.g. "cmd+c", "shift+alt+tab").
///
/// Parses the "+"-separated string, presses modifiers first, then the
/// final key, then releases in reverse order.
#[napi]
pub async fn keys(key: String) -> Result<()> {
    enigo_wrap::key_chord(&key)
        .map_err(|e| Error::from_reason(e))
}

/// Type a string of text via the keyboard.
///
/// Uses enigo's text() which handles Unicode via CGEventKeyboardSetUnicodeString.
/// On macOS this uses the fast text entry path when available.
#[napi(js_name = "typeText")]
pub async fn type_text(text: String) -> Result<()> {
    enigo_wrap::type_text(&text)
        .map_err(|e| Error::from_reason(e))
}

/// Move the mouse cursor to (x, y).
///
/// When animated is true, interpolates from current position with an
/// ease-out curve. When false (default), teleports instantly.
#[napi(js_name = "moveMouse")]
pub async fn move_mouse(x: f64, y: f64, animated: Option<bool>) -> Result<()> {
    let animated = animated.unwrap_or(false);
    enigo_wrap::move_mouse(x as i32, y as i32, animated)
        .map_err(|e| Error::from_reason(e))
}

/// Perform a mouse button action.
///
/// button: "left", "right", "middle", "scrollUp", "scrollDown",
///         "scrollLeft", "scrollRight"
/// action: "press", "release", "click"
/// count:  number of clicks (for "click" action), default 1
#[napi(js_name = "mouseButton")]
pub async fn mouse_button(
    button: String,
    action: String,
    count: Option<i32>,
) -> Result<()> {
    let count = count.unwrap_or(1);
    enigo_wrap::mouse_button(&button, &action, count)
        .map_err(|e| Error::from_reason(e))
}

/// Scroll the mouse wheel.
///
/// amount: number of ticks
/// direction: "vertical" or "horizontal"
#[napi(js_name = "mouseScroll")]
pub async fn mouse_scroll(amount: i32, direction: String) -> Result<()> {
    enigo_wrap::mouse_scroll(amount, &direction)
        .map_err(|e| Error::from_reason(e))
}

/// Get the current mouse cursor position.
#[napi(js_name = "mouseLocation")]
pub async fn mouse_location() -> Result<MouseLocationResult> {
    let (x, y) = enigo_wrap::mouse_location()
        .map_err(|e| Error::from_reason(e))?;
    Ok(MouseLocationResult { x: x as f64, y: y as f64 })
}

/// Get the bitmask of currently pressed mouse buttons.
///
/// Bit 0 = left, bit 1 = right, bit 2 = middle, etc.
/// Uses NSEvent.pressedMouseButtons which is thread-safe.
#[napi(js_name = "pressedMouseButtons")]
pub async fn pressed_mouse_buttons() -> Result<i32> {
    enigo_wrap::pressed_mouse_buttons()
        .map_err(|e| Error::from_reason(e))
}

/// Get the frontmost application info.
///
/// Returns { bundleId, appName } or null if no frontmost app.
/// Uses NSWorkspace.shared.frontmostApplication.
#[napi(js_name = "getFrontmostAppInfo")]
pub async fn get_frontmost_app_info() -> Result<Option<FrontmostAppInfo>> {
    enigo_wrap::get_frontmost_app_info()
        .map_err(|e| Error::from_reason(e))
}

#[napi(js_name = "getFrontmostAppInfoSync")]
pub fn get_frontmost_app_info_sync() -> Result<Option<FrontmostAppInfo>> {
    enigo_wrap::get_frontmost_app_info()
        .map_err(|e| Error::from_reason(e))
}

#[napi(object)]
pub struct MouseLocationResult {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct FrontmostAppInfo {
    /// macOS bundle identifier (e.g. "com.apple.Safari")
    /// Windows: exe path
    pub bundle_id: String,
    /// Display name (e.g. "Safari")
    /// Windows: process name
    pub app_name: String,
}
