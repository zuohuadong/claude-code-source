//! enigo wrapper: dispatches all input operations to the macOS main thread.
//!
//! Original source path: claude-native/src/input/enigo_wrap.rs
//! Original binary: computer-use-input.node (Mach-O arm64, 856KB)
//!
//! Architecture recovered from binary:
//! - enigo::Enigo must run on the main thread (CGEventPost requirement)
//! - dispatch2::run_on_main bridges from tokio worker -> DispatchQueue.main
//! - key()/keys() return futures that resolve when the main-thread callback completes
//! - Under Electron: CFRunLoop drains main queue (works natively)
//! - Under libuv (Node/Bun): main queue stalls; caller must pump via
//!   @ant/computer-use-swift's _drainMainRunLoop

use enigo::{Enigo, Key, KeyboardControlling, MouseControlling};
use std::sync::mpsc;
use once_cell::sync::Lazy;
use std::collections::HashMap;

#[allow(non_camel_case_types)]
type NSInteger = isize;

// ---------------------------------------------------------------------------
// Key name -> enigo::Key mapping
// ---------------------------------------------------------------------------

/// Build the complete key mapping table.
///
/// All key names are lowercase. The full enum was recovered from binary
/// strings: the enigo crate serializes enum variant names for error
/// messages, and the complete list was present in the `.rodata` section.
fn build_key_map() -> HashMap<&'static str, Key> {
    let mut m = HashMap::new();
    // Modifiers
    m.insert("alt", Key::Alt);
    m.insert("option", Key::Alt);
    m.insert("lalt", Key::Alt);
    m.insert("ralt", Key::RAlt);
    m.insert("ralt", Key::RAlt);
    m.insert("shift", Key::LShift);
    m.insert("lshift", Key::LShift);
    m.insert("rshift", Key::RShift);
    m.insert("control", Key::Control);
    m.insert("ctrl", Key::Control);
    m.insert("lcontrol", Key::Control);
    m.insert("rcontrol", Key::RControl);
    m.insert("cmd", Key::Super);
    m.insert("command", Key::Super);
    m.insert("super", Key::Super);
    m.insert("win", Key::Super);
    m.insert("windows", Key::Super);
    m.insert("meta", Key::Super);
    // Navigation
    m.insert("return", Key::Return);
    m.insert("enter", Key::Return);
    m.insert("tab", Key::Tab);
    m.insert("space", Key::Space);
    m.insert("backspace", Key::Backspace);
    m.insert("escape", Key::Escape);
    m.insert("esc", Key::Escape);
    m.insert("delete", Key::Delete);
    m.insert("uparrow", Key::UpArrow);
    m.insert("downarrow", Key::DownArrow);
    m.insert("leftarrow", Key::LeftArrow);
    m.insert("rightarrow", Key::RightArrow);
    m.insert("pageup", Key::PageUp);
    m.insert("pagedown", Key::PageDown);
    m.insert("home", Key::Home);
    m.insert("end", Key::End);
    // Function keys
    m.insert("f1", Key::F1);
    m.insert("f2", Key::F2);
    m.insert("f3", Key::F3);
    m.insert("f4", Key::F4);
    m.insert("f5", Key::F5);
    m.insert("f6", Key::F6);
    m.insert("f7", Key::F7);
    m.insert("f8", Key::F8);
    m.insert("f9", Key::F9);
    m.insert("f10", Key::F10);
    m.insert("f11", Key::F11);
    m.insert("f12", Key::F12);
    m.insert("f13", Key::F13);
    m.insert("f14", Key::F14);
    m.insert("f15", Key::F15);
    m.insert("f16", Key::F16);
    m.insert("f17", Key::F17);
    m.insert("f18", Key::F18);
    m.insert("f19", Key::F19);
    m.insert("f20", Key::F20);
    // Numpad
    m.insert("numpad0", Key::Numpad0);
    m.insert("numpad1", Key::Numpad1);
    m.insert("numpad2", Key::Numpad2);
    m.insert("numpad3", Key::Numpad3);
    m.insert("numpad4", Key::Numpad4);
    m.insert("numpad5", Key::Numpad5);
    m.insert("numpad6", Key::Numpad6);
    m.insert("numpad7", Key::Numpad7);
    m.insert("numpad8", Key::Numpad8);
    m.insert("numpad9", Key::Numpad9);
    // Media / special keys (recovered from binary enum names)
    m.insert("brightnessdown", Key::BrightnessDown);
    m.insert("brightnessup", Key::BrightnessUp);
    m.insert("contrastup", Key::ContrastUp);
    m.insert("contrastdown", Key::ContrastDown);
    m.insert("eject", Key::Eject);
    m.insert("illuminationup", Key::IlluminationUp);
    m.insert("illuminationtoggle", Key::IlluminationToggle);
    m.insert("power", Key::Power);
    m.insert("vidmirror", Key::VidMirror);
    m.insert("volumedown", Key::VolumeDown);
    m.insert("volumemute", Key::VolumeMute);
    m.insert("volumeup", Key::VolumeUp);
    m.insert("launchpad", Key::Launchpad);
    m.insert("launchpanel", Key::LaunchPanel);
    m.insert("missioncontrol", Key::MissionControl);
    m.insert("mediafast", Key::MediaFast);
    m.insert("medianexttrack", Key::MediaNextTrack);
    m.insert("mediaplaypause", Key::MediaPlayPause);
    m.insert("mediaprevtrack", Key::MediaPrevTrack);
    m.insert("mediarewind", Key::MediaRewind);
    // Math
    m.insert("decimal", Key::Decimal);
    m.insert("divide", Key::Divide);
    // Misc
    m.insert("capslock", Key::CapsLock);
    m.insert("numlock", Key::NumLock);
    m.insert("scrolllock", Key::ScrollLock);
    m.insert("insert", Key::Insert);
    m.insert("printscreen", Key::PrintScreen);
    m.insert("pause", Key::Pause);
    m
}

static KEY_MAP: Lazy<HashMap<&'static str, Key>> = Lazy::new(build_key_map);

static MODIFIER_NAMES: Lazy<std::collections::HashSet<&'static str>> = Lazy::new(|| {
    std::collections::HashSet::from([
        "shift", "lshift", "rshift",
        "control", "ctrl", "lcontrol", "rcontrol",
        "alt", "option", "lalt", "ralt",
        "cmd", "command", "super", "win", "windows", "meta",
    ])
});

/// Resolve a key name string to an enigo::Key.
///
/// Handles: named keys (cmd, return, f1...), single characters (a, 1, !).
/// Returns Err with the exact message recovered from the binary:
///   "Invalid key name: <name>. Please use a valid key name."
fn resolve_key(name: &str) -> Result<Key, String> {
    let lower = name.to_lowercase();
    if let Some(k) = KEY_MAP.get(lower.as_str()) {
        return Ok(*k);
    }
    // Single character -> Layout key
    let chars: Vec<char> = name.chars().collect();
    if chars.len() == 1 {
        return Ok(Key::Layout(chars[0]));
    }
    Err(format!(
        "Invalid key name: {}. Please use a valid key name.",
        name
    ))
}

// ---------------------------------------------------------------------------
// Main-thread dispatch bridge
// ---------------------------------------------------------------------------

/// Run a closure on the macOS main thread and block until it returns.
///
/// Uses dispatch2::run_on_main which enqueues onto DispatchQueue.main.
/// The channel receiver blocks the tokio worker until the closure sends
/// its result back. Under Electron, the main queue is drained by CFRunLoop
/// automatically. Under Node/Bun (libuv), the caller must pump the run loop.
fn run_on_main<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut Enigo) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Result<R, String>>();
    dispatch2::run_on_main(move || {
        let mut enigo = match Enigo::new() {
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
    rx.recv().map_err(|e| {
        format!("Failed to receive result from main thread operation: {}", e)
    })?
}

// ---------------------------------------------------------------------------
// Public API implementations
// ---------------------------------------------------------------------------

/// Press, release, or click a single key.
///
/// action: "press", "release", or "click" (default: click)
pub fn key_action(key_name: &str, action: &str) -> Result<(), String> {
    let key = resolve_key(key_name)?;
    let act = action.to_lowercase();
    run_on_main(move |enigo| {
        match act.as_str() {
            "press" => enigo.key_down(key).map_err(|e| format!("Error pressing key: {}", e))?,
            "release" => enigo.key_up(key).map_err(|e| format!("Error releasing key: {}", e))?,
            "click" => {
                enigo.key_down(key).map_err(|e| format!("Error pressing key: {}", e))?;
                enigo.key_up(key).map_err(|e| format!("Error releasing key: {}", e))?;
            }
            _ => {
                return Err(format!(
                    "Invalid action: {}. Valid options are: press, release, click",
                    act
                ));
            }
        }
        Ok(())
    })
}

/// Press a key chord like "cmd+c" or "shift+alt+tab".
///
/// Parses modifiers, presses them, presses the final key, releases the
/// final key, then releases modifiers in reverse order.
pub fn key_chord(chord: &str) -> Result<(), String> {
    let parts: Vec<String> = chord
        .split('+')
        .map(|s| s.trim().to_string())
        .collect();
    if parts.is_empty() {
        return Err("No keys provided".to_string());
    }

    let mut modifiers: Vec<Key> = Vec::new();
    let mut final_key: Option<String> = None;

    for part in &parts {
        let lower = part.to_lowercase();
        if MODIFIER_NAMES.contains(lower.as_str()) {
            modifiers.push(resolve_key(part)?);
        } else if final_key.is_none() {
            final_key = Some(part.clone());
        } else {
            // Multiple non-modifier keys — treat as sequential press
            modifiers.push(resolve_key(part)?);
        }
    }

    let final_key = final_key.ok_or_else(|| "No keys provided".to_string())?;
    let final_enigo_key = resolve_key(&final_key)?;

    run_on_main(move |enigo| {
        // Press modifiers
        for m in &modifiers {
            enigo.key_down(*m).map_err(|e| {
                format!("Error pressing modifier key: {}", e)
            })?;
        }
        // Click final key
        enigo.key_down(final_enigo_key).map_err(|e| {
            format!("Error pressing key: {}", e)
        })?;
        enigo.key_up(final_enigo_key).map_err(|e| {
            format!("Error releasing key: {}", e)
        })?;
        // Release modifiers in reverse
        for m in modifiers.iter().rev() {
            enigo.key_up(*m).map_err(|e| {
                format!("Error releasing modifier key: {}", e)
            })?;
        }
        Ok(())
    })
}

/// Type text via enigo's text() method.
///
/// On macOS, enigo uses CGEventKeyboardSetUnicodeString which handles
/// Unicode properly. When the keyboard layout doesn't support fast text
/// entry, enigo falls back to individual character entry.
pub fn type_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("The text to enter was empty".to_string());
    }
    let text = text.to_string();
    run_on_main(move |enigo| {
        enigo.text(&text).map_err(|e| {
            format!("Error typing text: {}", e)
        })?;
        Ok(())
    })
}

/// Move mouse to (x, y). Animated path uses linear interpolation at ~60fps.
pub fn move_mouse(x: i32, y: i32, animated: bool) -> Result<(), String> {
    run_on_main(move |enigo| {
        if animated {
            // Get current position and interpolate
            let (cur_x, cur_y) = current_mouse_position(enigo);
            let steps = 10; // ~166ms at 60fps
            for i in 1..=steps {
                let t = i as f64 / steps as f64;
                let ease = 1.0 - (1.0 - t).powi(3); // ease-out-cubic
                let ix = cur_x as f64 + (x as f64 - cur_x as f64) * ease;
                let iy = cur_y as f64 + (y as f64 - cur_y as f64) * ease;
                enigo.mouse_move_to(ix as i32, iy as i32).map_err(|e| {
                    format!("Error moving mouse: {}", e)
                })?;
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
        } else {
            enigo.mouse_move_to(x, y).map_err(|e| {
                format!("Error moving mouse: {}", e)
            })?;
        }
        Ok(())
    })
}

/// Perform a mouse button action.
///
/// Valid button names: left, right, middle, scrollUp, scrollDown,
///   scrollLeft, scrollRight
/// Valid actions: press, release, click
pub fn mouse_button(button: &str, action: &str, count: i32) -> Result<(), String> {
    let btn = parse_mouse_button(button)?;
    let act = action.to_lowercase();

    run_on_main(move |enigo| {
        match act.as_str() {
            "press" => {
                enigo.mouse_down(btn).map_err(|e| {
                    format!("Error performing button action on attempt: {}", e)
                })?;
            }
            "release" => {
                // On macOS, mouse_up for Scroll buttons has no effect
                enigo.mouse_up(btn).map_err(|e| {
                    format!("Error performing button action on attempt: {}", e)
                })?;
            }
            "click" => {
                for _ in 0..count {
                    enigo.mouse_down(btn).map_err(|e| {
                        format!("Error performing button action on attempt: {}", e)
                    })?;
                    enigo.mouse_up(btn).map_err(|e| {
                        format!("Error performing button action on attempt: {}", e)
                    })?;
                }
            }
            _ => {
                return Err(format!(
                    "Invalid action: {}. Valid options are: press, release, click",
                    act
                ));
            }
        }
        Ok(())
    })
}

/// Scroll the mouse wheel.
///
/// amount: number of ticks (positive = down/right, negative = up/left)
/// direction: "vertical" or "horizontal"
pub fn mouse_scroll(amount: i32, direction: &str) -> Result<(), String> {
    let dir = direction.to_lowercase();
    let horiz = match dir.as_str() {
        "vertical" => false,
        "horizontal" => true,
        _ => return Err(format!("Invalid scroll direction: {}", direction)),
    };

    run_on_main(move |enigo| {
        if horiz {
            enigo.mouse_scroll_x(amount).map_err(|e| {
                format!("Error performing scroll action: {}", e)
            })?;
        } else {
            enigo.mouse_scroll_y(amount).map_err(|e| {
                format!("Error performing scroll action: {}", e)
            })?;
        }
        Ok(())
    })
}

/// Get the current mouse cursor position.
pub fn mouse_location() -> Result<(i32, i32), String> {
    run_on_main(|enigo| {
        let (x, y) = current_mouse_position(enigo);
        Ok((x, y))
    })
}

/// Get the bitmask of pressed mouse buttons.
///
/// Uses NSEvent.pressedMouseButtons which is thread-safe.
/// Bit 0 = left, bit 1 = right, bit 2 = middle, etc.
pub fn pressed_mouse_buttons() -> Result<i32, String> {
    // NSEvent.pressedMouseButtons is thread-safe and returns a bitmask.
    // Bit 0 = left, bit 1 = right, bit 2 = middle.
    // We use core_graphics::event_source::CGEventSource which provides
    // the same data without requiring AppKit on the main thread.
    //
    // Alternative: call NSEvent.pressedMouseButtons via objc2 on main thread,
    // but CGEventSource is simpler and doesn't require main-thread dispatch.
    run_on_main(|_enigo| {
        // On the main thread we can safely use NSApp / NSEvent.
        // Dispatch to main, read NSEvent.pressedMouseButtons.
        // Since we're already in run_on_main, use a direct approach.
        //
        // NSEvent.pressedMouseButtons is a class method that returns the
        // combined mouse button state as a bitmask. It works from any thread
        // in practice, but Apple docs say main thread.
        // We use CGEventSourceFlagsState for the actual read:
        //   CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState,
        //                            kCGMouseEventSubtype)
        //
        // Simplest: use core_graphics directly.
        let buttons = unsafe {
            CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState)
        };
        Ok(buttons)
    })
}

/// Get frontmost application info from NSWorkspace.
pub fn get_frontmost_app_info() -> Result<Option<crate::FrontmostAppInfo>, String> {
    // NSWorkspace.frontmostApplication must be called on the main thread.
    // We dispatch via run_on_main and extract bundleId + localizedName.
    run_on_main(|_enigo| {
        // Access NSWorkspace.shared.frontmostApplication via objc2 on main thread.
        // This is safe because run_on_main dispatches to DispatchQueue.main.
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::msg_send;
        use objc2_foundation::NSString;

        unsafe {
            // NSWorkspace *ws = [NSWorkspace sharedWorkspace];
            let ws_class = objc2::class!(NSWorkspace);
            let ws: Retained<AnyObject> = msg_send![ws_class, sharedWorkspace];

            // NSRunningApplication *app = [ws frontmostApplication];
            let app: Option<Retained<AnyObject>> = msg_send![&ws, frontmostApplication];

            match app {
                Some(app) => {
                    // NSString *bid = [app bundleIdentifier];
                    let bid_ns: Option<Retained<NSString>> = msg_send![&app, bundleIdentifier];
                    let bundle_id = bid_ns.map(|s| s.to_string()).unwrap_or_default();

                    // NSString *name = [app localizedName];
                    let name_ns: Option<Retained<NSString>> = msg_send![&app, localizedName];
                    let app_name = name_ns.map(|s| s.to_string()).unwrap_or_default();

                    Ok(Some(crate::FrontmostAppInfo {
                        bundle_id,
                        app_name,
                    }))
                }
                None => Ok(None),
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_mouse_button(name: &str) -> Result<enigo::MouseButton, String> {
    match name.to_lowercase().as_str() {
        "left" => Ok(enigo::MouseButton::Left),
        "right" => Ok(enigo::MouseButton::Right),
        "middle" | "center" => Ok(enigo::MouseButton::Middle),
        "scrollup" | "forward" => Ok(enigo::MouseButton::ScrollUp),
        "scrolldown" | "back" => Ok(enigo::MouseButton::ScrollDown),
        "scrollleft" => Ok(enigo::MouseButton::ScrollLeft),
        "scrollright" => Ok(enigo::MouseButton::ScrollRight),
        _ => Err(format!(
            "Invalid button name: {}. Valid options are: left, right, middle, scrollUp, scrollDown, scrollLeft, scrollRight",
            name
        )),
    }
}

/// Read current mouse position via CGEvent.
fn current_mouse_position(_enigo: &Enigo) -> (i32, i32) {
    // Read cursor position via CGEventCreate on the combined session state.
    // CGEvent::new(nil) works for reading the current mouse location.
    unsafe {
        let event = core_graphics::event::CGEvent::new(None);
        match event {
            Some(e) => {
                let p = e.location();
                // CGEvent location is in global display coordinates (origin top-left
                // of primary display for CGDirectDisplay coordinates on macOS).
                (p.x as i32, p.y as i32)
            }
            None => (0, 0),
        }
    }
}
