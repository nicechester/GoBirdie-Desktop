// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "gobirdie-sync-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "gobirdie-sync-helper",
            path: "Sources",
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/Info.plist"])
            ]
        )
    ]
)
