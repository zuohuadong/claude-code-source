//! Platform abstraction layer.
//!
//! macOS: enigo requires main-thread dispatch (CGEventPost). dispatch2 bridges
//! from tokio worker to DispatchQueue.main. Under libuv, the caller must pump
//! CFRunLoop via _drainMainRunLoop.
//!
//! Windows: SendInput is thread-safe, no dispatch needed. enigo calls go direct.

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform_impl;

#[cfg(target_os = "windows")]
#[path = "win32.rs"]
mod platform_impl;

pub use platform_impl::*;
