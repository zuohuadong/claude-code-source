//! macOS platform backend.
//!
//! enigo's macOS backend uses CGEventPost which must run on the main thread.
//! dispatch2::run_on_main bridges from a tokio worker to DispatchQueue.main.
//! Under Electron, CFRunLoop drains the main queue automatically; under
//! libuv (Node/Bun), the caller must pump via _drainMainRunLoop.

use enigo::{Enigo, Settings};
use std::sync::mpsc;

/// Run a closure on the macOS main thread with a fresh Enigo instance.
///
/// The channel receiver blocks the calling thread until the closure completes.
pub fn with_enigo<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut Enigo) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Result<R, String>>();
    dispatch2::run_on_main(move |_| {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => e,
            Err(e) => {
                let _ = tx.send(Err(format!(
                    "The application does not have the permission to simulate input! ({})",
                    e
                )));
                return;
            }
        };
        let result = f(&mut enigo);
        let _ = tx.send(result);
    });
    rx.recv()
        .map_err(|e| format!("Failed to receive result from main thread operation: {}", e))?
}

/// Read current mouse position via CGEvent on the combined session state.
pub fn current_mouse_position(_enigo: &Enigo) -> (i32, i32) {
    let source = core_graphics::event_source::CGEventSource::new(
        core_graphics::event_source::CGEventSourceStateID::CombinedSessionState,
    );
    match source.and_then(core_graphics::event::CGEvent::new) {
        Ok(e) => {
            let p = e.location();
            (p.x as i32, p.y as i32)
        }
        Err(_) => (0, 0),
    }
}

// Get pressed mouse button bitmask via CoreGraphics CGEventSourceButtonState.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

const COMBINED_SESSION_STATE: i32 = 0;

pub fn pressed_mouse_buttons() -> Result<i32, String> {
    let mut bitmask = 0i32;
    for button in 0..32 {
        let pressed = unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, button) };
        if pressed {
            bitmask |= 1 << button;
        }
    }
    Ok(bitmask)
}

/// Get frontmost application via osascript (avoids objc2 version conflicts).
pub fn get_frontmost_app_info() -> Result<Option<crate::FrontmostAppInfo>, String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(
            r#"tell application "System Events"
set frontApp to first application process whose frontmost is true
set appName to name of frontApp
set bundleId to bundle identifier of frontApp
if bundleId is missing value then set bundleId to ""
return bundleId & tab & appName
end tell"#,
        )
        .output()
        .map_err(|e| format!("Failed to query frontmost application: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let mut parts = trimmed.splitn(2, '\t');
    let bundle_id = parts.next().unwrap_or_default().to_string();
    let app_name = parts.next().unwrap_or_default().to_string();
    if bundle_id.is_empty() && app_name.is_empty() {
        return Ok(None);
    }

    Ok(Some(crate::FrontmostAppInfo {
        bundle_id,
        app_name,
    }))
}
