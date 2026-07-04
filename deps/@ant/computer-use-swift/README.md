# @ant/computer-use-swift

Swift native macOS backend for Computer Use screenshots and display management.

## Architecture

```
Node.js / Bun
  -> src/index.ts (platform detection + native loader)
     -> src/backends/darwin.ts (native .node addon)
     -> src/backends/win32.ts (PowerShell + .NET)
```

### Native addon (Swift)

The `prebuilds/computer_use.node` binary is a Swift NAPI addon using
[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
for screenshot capture with per-app exclusion, Spotlight
(NSMetadataQuery) for installed app enumeration, and CoreGraphics for
display management.

Requires macOS 14.0+ (ScreenCaptureKit dependency).

Source files:

| File | Contents |
|---|---|
| `Sources/ComputerUseSwift/Types.swift` | Data models (InstalledApp, ScreenshotResult, etc) |
| `Sources/ComputerUseSwift/Screenshot.swift` | ScreenCaptureKit capture with app exclusion |
| `Sources/ComputerUseSwift/InstalledApps.swift` | Spotlight-based app enumeration + cache |
| `Sources/ComputerUseSwift/Display.swift` | Display geometry, window management, hide/unhide |
| `Sources/ComputerUseSwift/EscTap.swift` | CGEventTap ESC abort mechanism |
| `Sources/ComputerUseSwift/ComputerUseBindings.swift` | Main NAPI bridge + all exported methods |
| `Sources/ComputerUseSwift/NapiBridge.swift` | C glue for napi_register_module_v1 |

### Exported methods (20+)

`screenshot`, `captureExcluding`, `captureRegion`, `listInstalled`,
`prepareDisplay`, `resolvePrepareCapture`, `display`, `displayIds`,
`displays`, `findWindowDisplays`, `frontmostApplication`,
`resolveBundleIds`, `checkAccessibility`, `checkScreenRecording`,
`requestAccessibility`, `requestScreenRecording`,
`notifyExpectedEscape`, `unhide`, `open`, `previewHideSet`,
`_drainMainRunLoop`.

### Building from source (macOS)

```bash
swift build -c release
# Output: .build/release/libComputerUseSwift.dylib
```

For NAPI packaging, the dylib is linked into a .node addon via the
napi_register_module_v1 entry point.
