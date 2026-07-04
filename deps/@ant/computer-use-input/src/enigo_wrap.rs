//! Cross-platform input wrapper using enigo.
//!
//! macOS: enigo dispatches to DispatchQueue.main via dispatch2 (CGEventPost
//! requires main thread). Under libuv, caller pumps CFRunLoop.
//! Windows: SendInput is thread-safe, calls go direct. No dispatch needed.

#[path = "platform/mod.rs"]
mod platform;

use enigo::{
    Axis, Button, Coordinate, Direction, Key, Keyboard, Mouse,
};
use once_cell::sync::Lazy;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Key name -> enigo::Key mapping
// ---------------------------------------------------------------------------

fn build_key_map() -> HashMap<&'static str, Key> {
    let mut m = HashMap::new();

    // --- Modifiers (cross-platform) ---
    m.insert("alt", Key::Alt);
    m.insert("option", Key::Alt);
    m.insert("lalt", Key::Alt);
    m.insert("shift", Key::LShift);
    m.insert("lshift", Key::LShift);
    m.insert("rshift", Key::RShift);
    m.insert("control", Key::Control);
    m.insert("ctrl", Key::Control);
    m.insert("lcontrol", Key::LControl);
    m.insert("rcontrol", Key::RControl);
    m.insert("cmd", Key::Meta);
    m.insert("command", Key::Meta);
    m.insert("super", Key::Meta);
    m.insert("win", Key::Meta);
    m.insert("windows", Key::Meta);
    m.insert("meta", Key::Meta);

    // --- Navigation (cross-platform) ---
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

    // --- Function keys (F1-F20 cross-platform) ---
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

    // --- Numpad (cross-platform) ---
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

    // --- Math / misc (cross-platform) ---
    m.insert("add", Key::Add);
    m.insert("subtract", Key::Subtract);
    m.insert("multiply", Key::Multiply);
    m.insert("decimal", Key::Decimal);
    m.insert("divide", Key::Divide);
    m.insert("help", Key::Help);
    m.insert("capslock", Key::CapsLock);

    // --- Volume / media (cross-platform subset) ---
    m.insert("volumedown", Key::VolumeDown);
    m.insert("volumemute", Key::VolumeMute);
    m.insert("volumeup", Key::VolumeUp);
    m.insert("medianexttrack", Key::MediaNextTrack);
    m.insert("mediaplaypause", Key::MediaPlayPause);
    m.insert("mediaprevtrack", Key::MediaPrevTrack);

    // --- macOS-only keys ---
    #[cfg(target_os = "macos")]
    {
        m.insert("ralt", Key::ROption);
        m.insert("brightnessdown", Key::BrightnessDown);
        m.insert("brightnessup", Key::BrightnessUp);
        m.insert("contrastup", Key::ContrastUp);
        m.insert("contrastdown", Key::ContrastDown);
        m.insert("eject", Key::Eject);
        m.insert("illuminationup", Key::IlluminationUp);
        m.insert("illuminationtoggle", Key::IlluminationToggle);
        m.insert("power", Key::Power);
        m.insert("vidmirror", Key::VidMirror);
        m.insert("launchpad", Key::Launchpad);
        m.insert("launchpanel", Key::LaunchPanel);
        m.insert("missioncontrol", Key::MissionControl);
        m.insert("mediafast", Key::MediaFast);
        m.insert("mediarewind", Key::MediaRewind);
    }

    // --- Windows-only keys ---
    #[cfg(target_os = "windows")]
    {
        m.insert("ralt", Key::RMenu);
        m.insert("numlock", Key::Numlock);
        m.insert("scrolllock", Key::Scroll);
        m.insert("insert", Key::Insert);
        m.insert("printscreen", Key::PrintScr);
        m.insert("pause", Key::Pause);
        m.insert("f21", Key::F21);
        m.insert("f22", Key::F22);
        m.insert("f23", Key::F23);
        m.insert("f24", Key::F24);
        m.insert("mediastop", Key::MediaStop);
    }

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

fn resolve_key(name: &str) -> Result<Key, String> {
    let lower = name.to_lowercase();
    if let Some(k) = KEY_MAP.get(lower.as_str()) {
        return Ok(*k);
    }
    let chars: Vec<char> = name.chars().collect();
    if chars.len() == 1 {
        return Ok(Key::Unicode(chars[0]));
    }
    Err(format!(
        "Invalid key name: {}. Please use a valid key name.",
        name
    ))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn key_action(key_name: &str, action: &str) -> Result<(), String> {
    let key = resolve_key(key_name)?;
    let act = action.to_lowercase();
    platform::with_enigo(move |enigo| {
        match act.as_str() {
            "press" => enigo
                .key(key, Direction::Press)
                .map_err(|e| format!("Error pressing key: {}", e))?,
            "release" => enigo
                .key(key, Direction::Release)
                .map_err(|e| format!("Error releasing key: {}", e))?,
            "click" => {
                enigo
                    .key(key, Direction::Click)
                    .map_err(|e| format!("Error performing key action: {}", e))?;
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

pub fn key_chord(chord: &str) -> Result<(), String> {
    let parts: Vec<String> = chord.split('+').map(|s| s.trim().to_string()).collect();
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
            modifiers.push(resolve_key(part)?);
        }
    }

    let final_key = final_key.ok_or_else(|| "No keys provided".to_string())?;
    let final_enigo_key = resolve_key(&final_key)?;

    platform::with_enigo(move |enigo| {
        for m in &modifiers {
            enigo.key(*m, Direction::Press)
                .map_err(|e| format!("Error pressing modifier key: {}", e))?;
        }
        enigo.key(final_enigo_key, Direction::Click)
            .map_err(|e| format!("Error performing key action: {}", e))?;
        for m in modifiers.iter().rev() {
            enigo.key(*m, Direction::Release)
                .map_err(|e| format!("Error releasing modifier key: {}", e))?;
        }
        Ok(())
    })
}

pub fn type_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("The text to enter was empty".to_string());
    }
    let text = text.to_string();
    platform::with_enigo(move |enigo| {
        enigo.text(&text)
            .map_err(|e| format!("Error typing text: {}", e))?;
        Ok(())
    })
}

pub fn move_mouse(x: i32, y: i32, animated: bool) -> Result<(), String> {
    platform::with_enigo(move |enigo| {
        if animated {
            let (cur_x, cur_y) = platform::current_mouse_position(enigo);
            let steps = 10;
            for i in 1..=steps {
                let t = i as f64 / steps as f64;
                let ease = 1.0 - (1.0 - t).powi(3);
                let ix = cur_x as f64 + (x as f64 - cur_x as f64) * ease;
                let iy = cur_y as f64 + (y as f64 - cur_y as f64) * ease;
                enigo.move_mouse(ix as i32, iy as i32, Coordinate::Abs)
                    .map_err(|e| format!("Error moving mouse: {}", e))?;
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
        } else {
            enigo.move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| format!("Error moving mouse: {}", e))?;
        }
        Ok(())
    })
}

pub fn mouse_button(button: &str, action: &str, count: i32) -> Result<(), String> {
    let btn = parse_mouse_button(button)?;
    let act = action.to_lowercase();

    platform::with_enigo(move |enigo| {
        match act.as_str() {
            "press" => {
                enigo.button(btn, Direction::Press)
                    .map_err(|e| format!("Error performing button action: {}", e))?;
            }
            "release" => {
                enigo.button(btn, Direction::Release)
                    .map_err(|e| format!("Error performing button action: {}", e))?;
            }
            "click" => {
                for _ in 0..count {
                    enigo.button(btn, Direction::Click)
                        .map_err(|e| format!("Error performing button action: {}", e))?;
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

pub fn mouse_scroll(amount: i32, direction: &str) -> Result<(), String> {
    let dir = direction.to_lowercase();
    let horiz = match dir.as_str() {
        "vertical" => false,
        "horizontal" => true,
        _ => return Err(format!("Invalid scroll direction: {}", direction)),
    };

    platform::with_enigo(move |enigo| {
        if horiz {
            enigo.scroll(amount, Axis::Horizontal)
                .map_err(|e| format!("Error performing scroll action: {}", e))?;
        } else {
            enigo.scroll(amount, Axis::Vertical)
                .map_err(|e| format!("Error performing scroll action: {}", e))?;
        }
        Ok(())
    })
}

pub fn mouse_location() -> Result<(i32, i32), String> {
    platform::with_enigo(|enigo| {
        let (x, y) = platform::current_mouse_position(enigo);
        Ok((x, y))
    })
}

pub fn pressed_mouse_buttons() -> Result<i32, String> {
    platform::pressed_mouse_buttons()
}

pub fn get_frontmost_app_info() -> Result<Option<crate::FrontmostAppInfo>, String> {
    platform::get_frontmost_app_info()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_mouse_button(name: &str) -> Result<Button, String> {
    match name.to_lowercase().as_str() {
        "left" => Ok(Button::Left),
        "right" => Ok(Button::Right),
        "middle" | "center" => Ok(Button::Middle),
        "scrollup" | "forward" => Ok(Button::ScrollUp),
        "scrolldown" | "back" => Ok(Button::ScrollDown),
        "scrollleft" => Ok(Button::ScrollLeft),
        "scrollright" => Ok(Button::ScrollRight),
        _ => Err(format!(
            "Invalid button name: {}. Valid options are: left, right, middle, scrollUp, scrollDown, scrollLeft, scrollRight",
            name
        )),
    }
}
