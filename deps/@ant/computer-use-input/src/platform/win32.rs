//! Windows platform backend — direct SendInput implementation.
//!
//! Bypasses enigo entirely on Windows. Uses Win32 SendInput with:
//!   - MOUSEEVENTF_ABSOLUTE + 0-65535 coordinate normalization
//!   - MOUSEEVENTF_LEFTDOWN/UP, RIGHTDOWN/UP, MIDDLEDOWN/UP
//!   - MOUSEEVENTF_WHEEL / MOUSEEVENTF_HWHEEL for scrolling
//!   - KEYEVENTF_UNICODE for text entry (UTF-16 code units)
//!   - VK_* virtual key codes for key press/release/chord
//!
//! SendInput is thread-safe — no main-thread dispatch needed.
//!
//! Win32 APIs used:
//!   - SendInput / INPUT / MOUSEINPUT / KEYBDINPUT
//!   - GetCursorPos / GetAsyncKeyState / GetForegroundWindow
//!   - GetWindowThreadProcessId / OpenProcess / QueryFullProcessImageNameW
//!   - GetSystemMetrics (SM_CXSCREEN / SM_CYSCREEN)

use std::collections::HashMap;
use std::sync::OnceLock;

use windows::Win32::Foundation::{CloseHandle, POINT};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE,
    KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, KEYBD_EVENT_FLAGS,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowThreadProcessId,
    SM_CXSCREEN, SM_CYSCREEN,
};

// ── Screen size + coordinate normalization ──────────────────────────────────

fn screen_size() -> (i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_CXSCREEN),
            GetSystemMetrics(SM_CYSCREEN),
        )
    }
}

/// Convert pixel coordinates to absolute normalized coordinates (0-65535).
///
/// SendInput with MOUSEEVENTF_ABSOLUTE expects coordinates in the range
/// [0, 65535] mapped across the full screen. The formula is:
///   absolute = (pixel * 65535) / screen_dimension
fn to_absolute(x: f64, y: f64) -> (i32, i32) {
    let (sw, sh) = screen_size();
    let ax = ((x * 65535.0) / sw as f64) as i32;
    let ay = ((y * 65535.0) / sh as f64) as i32;
    (ax, ay)
}

// ── SendInput helpers ────────────────────────────────────────────────────────

fn send_mouse(dx: i32, dy: i32, flags: MOUSE_EVENT_FLAGS, data: i32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

fn send_key(vk: VIRTUAL_KEY, scan: u16, down: bool) {
    let flags = if down {
        KEYBD_EVENT_FLAGS(0)
    } else {
        KEYEVENTF_KEYUP
    };
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

// ── Virtual key map ─────────────────────────────────────────────────────────

static VK_MAP: OnceLock<HashMap<&'static str, VIRTUAL_KEY>> = OnceLock::new();

fn vk_map() -> &'static HashMap<&'static str, VIRTUAL_KEY> {
    VK_MAP.get_or_init(|| {
        use windows::Win32::UI::Input::KeyboardAndMouse::*;

        let mut m = HashMap::new();

        // Modifiers
        m.insert("shift", VK_SHIFT);
        m.insert("lshift", VK_LSHIFT);
        m.insert("rshift", VK_RSHIFT);
        m.insert("control", VK_CONTROL);
        m.insert("ctrl", VK_CONTROL);
        m.insert("lcontrol", VK_LCONTROL);
        m.insert("rcontrol", VK_RCONTROL);
        m.insert("alt", VK_MENU);
        m.insert("option", VK_MENU);
        m.insert("lalt", VK_LMENU);
        m.insert("ralt", VK_RMENU);
        m.insert("cmd", VK_LWIN);
        m.insert("command", VK_LWIN);
        m.insert("super", VK_LWIN);
        m.insert("win", VK_LWIN);
        m.insert("windows", VK_LWIN);
        m.insert("meta", VK_LWIN);

        // Navigation
        m.insert("return", VK_RETURN);
        m.insert("enter", VK_RETURN);
        m.insert("tab", VK_TAB);
        m.insert("space", VK_SPACE);
        m.insert("backspace", VK_BACK);
        m.insert("delete", VK_DELETE);
        m.insert("escape", VK_ESCAPE);
        m.insert("esc", VK_ESCAPE);
        m.insert("insert", VK_INSERT);
        m.insert("printscreen", VK_SNAPSHOT);
        m.insert("pause", VK_PAUSE);
        m.insert("home", VK_HOME);
        m.insert("end", VK_END);
        m.insert("pageup", VK_PRIOR);
        m.insert("pagedown", VK_NEXT);
        m.insert("left", VK_LEFT);
        m.insert("leftarrow", VK_LEFT);
        m.insert("right", VK_RIGHT);
        m.insert("rightarrow", VK_RIGHT);
        m.insert("up", VK_UP);
        m.insert("uparrow", VK_UP);
        m.insert("down", VK_DOWN);
        m.insert("downarrow", VK_DOWN);

        // Function keys F1-F24
        m.insert("f1", VK_F1);
        m.insert("f2", VK_F2);
        m.insert("f3", VK_F3);
        m.insert("f4", VK_F4);
        m.insert("f5", VK_F5);
        m.insert("f6", VK_F6);
        m.insert("f7", VK_F7);
        m.insert("f8", VK_F8);
        m.insert("f9", VK_F9);
        m.insert("f10", VK_F10);
        m.insert("f11", VK_F11);
        m.insert("f12", VK_F12);
        m.insert("f13", VK_F13);
        m.insert("f14", VK_F14);
        m.insert("f15", VK_F15);
        m.insert("f16", VK_F16);
        m.insert("f17", VK_F17);
        m.insert("f18", VK_F18);
        m.insert("f19", VK_F19);
        m.insert("f20", VK_F20);
        m.insert("f21", VK_F21);
        m.insert("f22", VK_F22);
        m.insert("f23", VK_F23);
        m.insert("f24", VK_F24);

        // Lock keys
        m.insert("capslock", VK_CAPITAL);
        m.insert("numlock", VK_NUMLOCK);
        m.insert("scrolllock", VK_SCROLL);

        // Numpad
        m.insert("numpad0", VK_NUMPAD0);
        m.insert("numpad1", VK_NUMPAD1);
        m.insert("numpad2", VK_NUMPAD2);
        m.insert("numpad3", VK_NUMPAD3);
        m.insert("numpad4", VK_NUMPAD4);
        m.insert("numpad5", VK_NUMPAD5);
        m.insert("numpad6", VK_NUMPAD6);
        m.insert("numpad7", VK_NUMPAD7);
        m.insert("numpad8", VK_NUMPAD8);
        m.insert("numpad9", VK_NUMPAD9);
        m.insert("decimal", VK_DECIMAL);
        m.insert("divide", VK_DIVIDE);
        m.insert("multiply", VK_MULTIPLY);
        m.insert("subtract", VK_SUBTRACT);
        m.insert("add", VK_ADD);

        // OEM keys
        m.insert("-", VK_OEM_MINUS);
        m.insert("=", VK_OEM_PLUS);
        m.insert("[", VK_OEM_4);
        m.insert("]", VK_OEM_6);
        m.insert("\\", VK_OEM_5);
        m.insert(";", VK_OEM_1);
        m.insert("'", VK_OEM_7);
        m.insert(",", VK_OEM_COMMA);
        m.insert(".", VK_OEM_PERIOD);
        m.insert("/", VK_OEM_2);
        m.insert("`", VK_OEM_3);

        m
    })
}

static MODIFIER_NAMES: std::sync::LazyLock<std::collections::HashSet<&'static str>> =
    std::sync::LazyLock::new(|| {
        std::collections::HashSet::from([
            "shift", "lshift", "rshift",
            "control", "ctrl", "lcontrol", "rcontrol",
            "alt", "option", "lalt", "ralt",
            "cmd", "command", "super", "win", "windows", "meta",
        ])
    });

fn is_vk_modifier(vk: VIRTUAL_KEY) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    matches!(
        vk,
        VK_SHIFT | VK_LSHIFT | VK_RSHIFT
            | VK_CONTROL | VK_LCONTROL | VK_RCONTROL
            | VK_MENU | VK_LMENU | VK_RMENU
            | VK_LWIN | VK_RWIN
    )
}

fn resolve_vk(name: &str) -> Result<VIRTUAL_KEY, String> {
    let lower = name.to_lowercase();
    if let Some(&vk) = vk_map().get(lower.as_str()) {
        return Ok(vk);
    }
    // Single character — convert to VK code via VkKeyScanW equivalent.
    // For ASCII letters/digits, VK codes are well-known.
    let chars: Vec<char> = name.chars().collect();
    if chars.len() == 1 {
        let c = chars[0];
        return Ok(char_to_vk(c));
    }
    Err(format!(
        "Invalid key name: {}. Please use a valid key name.",
        name
    ))
}

/// Map a single ASCII character to its Windows virtual key code.
fn char_to_vk(c: char) -> VIRTUAL_KEY {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    let code = match c {
        'a'..='z' => 0x41 + (c as u32 - 'a' as u32),
        'A'..='Z' => 0x41 + (c as u32 - 'A' as u32),
        '0'..='9' => 0x30 + (c as u32 - '0' as u32),
        ' ' => VK_SPACE.0,
        _ => {
            // For other characters, use Unicode scan code path instead.
            // Return 0 to signal "use Unicode" — callers should check.
            0
        }
    };
    VIRTUAL_KEY(code as u16)
}

// ── Platform API (called by enigo_wrap.rs) ───────────────────────────────────

pub fn key_action(key_name: &str, action: &str) -> Result<(), String> {
    let vk = resolve_vk(key_name)?;
    let act = action.to_lowercase();

    match act.as_str() {
        "press" => send_key(vk, 0, true),
        "release" => send_key(vk, 0, false),
        "click" => {
            send_key(vk, 0, true);
            send_key(vk, 0, false);
        }
        _ => {
            return Err(format!(
                "Invalid action: {}. Valid options are: press, release, click",
                act
            ));
        }
    }
    Ok(())
}

pub fn key_chord(chord: &str) -> Result<(), String> {
    let parts: Vec<String> = chord.split('+').map(|s| s.trim().to_string()).collect();
    if parts.is_empty() {
        return Err("No keys provided".to_string());
    }

    let mut modifiers: Vec<VIRTUAL_KEY> = Vec::new();
    let mut final_key: Option<String> = None;

    for part in &parts {
        let lower = part.to_lowercase();
        if MODIFIER_NAMES.contains(lower.as_str()) {
            modifiers.push(resolve_vk(part)?);
        } else if final_key.is_none() {
            final_key = Some(part.clone());
        } else {
            modifiers.push(resolve_vk(part)?);
        }
    }

    let final_key = final_key.ok_or_else(|| "No keys provided".to_string())?;
    let final_vk = resolve_vk(&final_key)?;

    // Press modifiers
    for &m in &modifiers {
        send_key(m, 0, true);
    }
    // Click final key
    send_key(final_vk, 0, true);
    send_key(final_vk, 0, false);
    // Release modifiers in reverse
    for &m in modifiers.iter().rev() {
        send_key(m, 0, false);
    }
    Ok(())
}

pub fn type_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("The text to enter was empty".to_string());
    }

    // Use KEYEVENTF_UNICODE for each UTF-16 code unit.
    // This correctly handles Unicode, CJK, emoji surrogate pairs, etc.
    let units: Vec<u16> = text.encode_utf16().collect();
    for &unit in &units {
        let down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        unsafe {
            let _ = SendInput(&[down, up], std::mem::size_of::<INPUT>() as i32);
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    Ok(())
}

pub fn move_mouse(x: i32, y: i32, animated: bool) -> Result<(), String> {
    let (ax, ay) = to_absolute(x as f64, y as f64);

    if animated {
        let (cur_x, cur_y) = current_mouse_position();
        let steps = 10;
        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            let ease = 1.0 - (1.0 - t).powi(3);
            let ix = cur_x as f64 + (x as f64 - cur_x as f64) * ease;
            let iy = cur_y as f64 + (y as f64 - cur_y as f64) * ease;
            let (nx, ny) = to_absolute(ix, iy);
            send_mouse(nx, ny, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0);
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    } else {
        send_mouse(ax, ay, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0);
    }
    Ok(())
}

pub fn mouse_button(button: &str, action: &str, count: i32) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    let (down, up) = match button.to_lowercase().as_str() {
        "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => return Err(format!("Invalid mouse button: {}", button)),
    };

    let act = action.to_lowercase();
    match act.as_str() {
        "press" => {
            send_mouse(0, 0, down, 0);
        }
        "release" => {
            send_mouse(0, 0, up, 0);
        }
        "click" => {
            for i in 0..count {
                send_mouse(0, 0, down, 0);
                send_mouse(0, 0, up, 0);
                if i < count - 1 {
                    std::thread::sleep(std::time::Duration::from_millis(30));
                }
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
}

pub fn mouse_scroll(amount: i32, direction: &str) -> Result<(), String> {
    let dir = direction.to_lowercase();
    match dir.as_str() {
        "vertical" => {
            // Negative = scroll up, Positive = scroll down (WHEEL_DELTA = 120)
            send_mouse(0, 0, MOUSEEVENTF_WHEEL, -amount * 120);
        }
        "horizontal" => {
            send_mouse(0, 0, MOUSEEVENTF_HWHEEL, amount * 120);
        }
        _ => return Err(format!("Invalid scroll direction: {}", direction)),
    }
    Ok(())
}

/// Read current mouse position via Win32 GetCursorPos.
pub fn current_mouse_position() -> (i32, i32) {
    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok.as_bool() {
        (point.x, point.y)
    } else {
        (0, 0)
    }
}

/// Get pressed mouse button bitmask via GetAsyncKeyState.
///
/// Bit 0 = left, bit 1 = right, bit 2 = middle, bit 3 = x1, bit 4 = x2.
pub fn pressed_mouse_buttons() -> Result<i32, String> {
    let mut mask = 0i32;
    // VK_LBUTTON=0x01, VK_RBUTTON=0x02, VK_MBUTTON=0x04, VK_XBUTTON1=0x05, VK_XBUTTON2=0x06
    let vk_buttons: &[(i32, i32)] = &[
        (0x01, 0), // left    -> bit 0
        (0x02, 1), // right   -> bit 1
        (0x04, 2), // middle  -> bit 2
        (0x05, 3), // x1      -> bit 3
        (0x06, 4), // x2      -> bit 4
    ];
    for &(vk, bit) in vk_buttons {
        let state = unsafe { GetAsyncKeyState(vk) };
        if state & 0x8000 != 0 {
            mask |= 1 << bit;
        }
    }
    Ok(mask)
}

/// Get frontmost application via GetForegroundWindow + process query.
///
/// Returns exe path as `bundle_id` and process name (basename) as `app_name`.
pub fn get_frontmost_app_info() -> Result<Option<crate::FrontmostAppInfo>, String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            return Ok(None);
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == 0 {
            return Ok(None);
        }

        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return Ok(None),
        };

        let mut buffer = [0u16; 1024];
        let mut len: u32 = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, false, &mut buffer, &mut len);
        let _ = CloseHandle(handle);

        if !ok.as_bool() || len == 0 {
            return Ok(None);
        }

        let exe_path = String::from_utf16_lossy(&buffer[..len as usize]);
        let app_name = std::path::Path::new(&exe_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        Ok(Some(crate::FrontmostAppInfo {
            bundle_id: exe_path,
            app_name,
        }))
    }
}
