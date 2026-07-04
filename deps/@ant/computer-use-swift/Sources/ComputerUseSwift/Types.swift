// Types.swift - Data models for ComputerUseSwift.
//
// All types recovered from binary reflection metadata (nominal type
// descriptors, CodingKeys, field descriptors) and match the shapes
// expected by the TypeScript ComputerExecutor interface.

import Foundation
import CoreGraphics

// MARK: - App info

/// Represents an installed application discovered via Spotlight.
/// Codable for NAPI serialization (JSON bridge).
struct InstalledApp: Codable, Equatable {
    let bundleId: String
    let displayName: String
    let path: String
    var iconDataUrl: String?

    enum CodingKeys: String, CodingKey {
        case bundleId
        case displayName
        case path
        case iconDataUrl
    }
}

/// Codable wrapper used for JSON interop with the NAPI layer.
/// Mirrors InstalledApp for serialization round-trips.
struct InstalledAppJson: Codable, Equatable {
    let bundleId: String
    let displayName: String
    let path: String
    let iconDataUrl: String?

    enum CodingKeys: String, CodingKey {
        case bundleId
        case displayName
        case path
        case iconDataUrl
    }
}

enum InstalledAppsError: Error, Equatable {
    case queryFailedToStart
}

// MARK: - Screenshot

/// Full-screen or region screenshot result.
/// base64 contains JPEG-encoded image data.
struct ScreenshotResult: Codable, Equatable {
    let base64: String
    let width: Int
    let height: Int
    let displayWidth: Int
    let displayHeight: Int
    let originX: Int
    let originY: Int
    var displayId: UInt32?

    enum CodingKeys: String, CodingKey {
        case base64
        case width
        case height
        case displayWidth
        case displayHeight
        case originX
        case originY
        case displayId
    }
}

/// Zoomed region screenshot (higher resolution subset).
struct ZoomResult: Codable, Equatable {
    let base64: String
    let width: Int
    let height: Int

    enum CodingKeys: String, CodingKey {
        case base64
        case width
        case height
    }
}

// MARK: - Display / window management

/// Result of prepareDisplay: which apps were hidden and which was activated.
struct PrepareDisplayResult: Codable, Equatable {
    let hidden: [String]
    let activated: String?

    enum CodingKeys: String, CodingKey {
        case hidden
        case activated
    }
}

/// Combined screenshot + prepare result for atomic capture.
/// Extends ScreenshotResult with hidden apps and activated app.
struct ResolvePrepareCaptureResult: Codable, Equatable {
    let base64: String
    let width: Int
    let height: Int
    let displayWidth: Int
    let displayHeight: Int
    let originX: Int
    let originY: Int
    let displayId: UInt32
    let hidden: [String]
    let activated: String?

    enum CodingKeys: String, CodingKey {
        case base64
        case width
        case height
        case displayWidth
        case displayHeight
        case originX
        case originY
        case displayId
        case hidden
        case activated
    }
}

// MARK: - Internal display geometry

/// Display geometry info for coordinate scaling.
struct CUDisplayInfo {
    let displayId: UInt32
    let width: CGFloat
    let height: CGFloat
    let originX: CGFloat
    let originY: CGFloat
    let scaleFactor: CGFloat
    let isPrimary: Bool
}

// MARK: - Running app

struct RunningApp {
    let bundleId: String
    let displayName: String
    let pid: pid_t?
}
