//! Windows platform backend.
//!
//! enigo's Windows backend uses SendInput which is thread-safe and does NOT
//! require main-thread dispatch. All calls go direct — no dispatch2, no
//! run-loop pumping needed.
//!
//! Win32 APIs used:
//!   - GetCursorPos / GetAsyncKeyState / GetForegroundWindow
//!   - GetWindowThreadProcessId / OpenProcess / QueryFullProcessImageNameW

use enigo::{Enigo, Settings};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindowThreadProcessId, POINT,
};

/// Run a closure with a fresh Enigo instance.
///
/// On Windows, SendInput is thread-safe — no dispatch needed.
pub fn with_enigo<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut Enigo) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo instance: {}", e))?;
    f(&mut enigo)
}

/// Read current mouse position via Win32 GetCursorPos.
pub fn current_mouse_position(_enigo: &Enigo) -> (i32, i32) {
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
/// Bit 0 = left, bit 1 = right, bit 2 = middle (matching macOS convention).
pub fn pressed_mouse_buttons() -> Result<i32, String> {
    let mut mask = 0i32;
    // VK_LBUTTON=0x01, VK_RBUTTON=0x02, VK_MBUTTON=0x04, VK_XBUTTON1=0x05, VK_XBUTTON2=0x06
    // High bit (0x8000) of the return value indicates the key is currently down.
    let vk_buttons: &[(i32, i32)] = &[
        (0x01, 0), // left  -> bit 0
        (0x02, 1), // right -> bit 1
        (0x04, 2), // middle -> bit 2
        (0x05, 3), // x1    -> bit 3
        (0x06, 4), // x2    -> bit 4
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
