//! Platform abstraction layer.
//!
//! macOS: enigo requires main-thread dispatch (CGEventPost). dispatch2 bridges
//! from tokio worker to DispatchQueue.main. Under libuv, the caller must pump
//! CFRunLoop via _drainMainRunLoop.
//!
//! Windows: direct SendInput calls (no enigo). SendInput is thread-safe, no
//! dispatch needed. Mouse uses MOUSEEVENTF_ABSOLUTE with 0-65535 normalization.
//! Keyboard uses VK_* virtual keys. Text entry uses KEYEVENTF_UNICODE.

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform_impl;

#[cfg(target_os = "windows")]
#[path = "win32.rs"]
mod platform_impl;

pub use platform_impl::*;
