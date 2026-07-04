// swift-tools-version:5.9
//
// ComputerUseSwift - Native macOS backend for @ant/computer-use-mcp.
//
// Provides: screenshot capture with app exclusion (ScreenCaptureKit),
// installed app enumeration (Spotlight), display management, window
// management (hide/unhide/activate), ESC key tap (abort signal), and
// NAPI bridge for Node.js integration.
//
// Requires: macOS 14.0+ (ScreenCaptureKit dependency)

import PackageDescription

let package = Package(
    name: "ComputerUseSwift",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "ComputerUseSwift",
            type: .dynamic,
            targets: ["ComputerUseSwift"]
        ),
    ],
    targets: [
        .target(
            name: "ComputerUseSwift",
            path: "Sources/ComputerUseSwift",
            resources: []
        )
    ]
)
