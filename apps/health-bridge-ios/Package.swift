// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "HealthBridge",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "HealthBridge", targets: ["HealthBridge"]),
        .executable(name: "HealthBridgeValidation", targets: ["HealthBridgeValidation"]),
    ],
    targets: [
        .target(
            name: "HealthBridge",
            path: "HealthBridge",
            exclude: [
                "ContentView.swift",
                "HealthBridge.entitlements",
                "HealthBridgeApp.swift",
                "Info.plist",
                "Services/BackgroundSyncManager.swift",
                "Services/HealthKitService.swift",
                "ViewModels/DebugViewModel.swift",
                "Views",
            ]
        ),
        .executableTarget(
            name: "HealthBridgeValidation",
            dependencies: ["HealthBridge"],
            path: "Validation"
        ),
        .testTarget(
            name: "HealthBridgeTests",
            dependencies: ["HealthBridge"],
            path: "HealthBridgeTests",
            exclude: [
                "BackgroundSyncManagerTests.swift",
            ]
        ),
    ]
)
