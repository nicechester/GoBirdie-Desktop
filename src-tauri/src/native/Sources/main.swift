import Foundation
import MultipeerConnectivity

// MARK: - Exit codes

enum ExitCode: Int32 {
    case success = 0
    case notFound = 1
    case transferError = 2
    case badUsage = 3
}

// MARK: - Browser delegate

final class SyncBrowser: NSObject, MCNearbyServiceBrowserDelegate, MCSessionDelegate {
    private let serviceType = "gobirdie"
    private let peerID = MCPeerID(displayName: "GoBirdie-Desktop")
    private let session: MCSession
    private let browser: MCNearbyServiceBrowser
    private let command: String
    private let timeoutSeconds: TimeInterval = 10

    init(command: String) {
        self.command = command
        session = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .none)
        browser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
        super.init()
        session.delegate = self
        browser.delegate = self
    }

    func run() {
        browser.startBrowsingForPeers()

        // Timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) {
            FileHandle.standardError.write(Data("Timeout: iPhone not found\n".utf8))
            exit(ExitCode.notFound.rawValue)
        }

        RunLoop.main.run()
    }

    // MARK: - MCNearbyServiceBrowserDelegate

    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        FileHandle.standardError.write(Data("Found peer: \(peerID.displayName)\n".utf8))
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: timeoutSeconds)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        FileHandle.standardError.write(Data("Browse failed: \(error.localizedDescription)\n".utf8))
        exit(ExitCode.transferError.rawValue)
    }

    // MARK: - MCSessionDelegate

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        guard state == .connected else { return }
        FileHandle.standardError.write(Data("Connected to \(peerID.displayName)\n".utf8))
        browser.stopBrowsingForPeers()

        // Send command
        guard let data = command.data(using: .utf8) else {
            exit(ExitCode.transferError.rawValue)
        }
        do {
            try session.send(data, toPeers: [peerID], with: .reliable)
        } catch {
            FileHandle.standardError.write(Data("Send failed: \(error.localizedDescription)\n".utf8))
            exit(ExitCode.transferError.rawValue)
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        // Print received JSON to stdout and exit
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(ExitCode.success.rawValue)
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

// MARK: - Main

let args = CommandLine.arguments.dropFirst()

guard let subcommand = args.first else {
    FileHandle.standardError.write(Data("Usage: gobirdie-sync-helper list | round <id>\n".utf8))
    exit(ExitCode.badUsage.rawValue)
}

let command: String
switch subcommand {
case "list":
    command = "list"
case "round":
    guard let id = args.dropFirst().first else {
        FileHandle.standardError.write(Data("Usage: gobirdie-sync-helper round <id>\n".utf8))
        exit(ExitCode.badUsage.rawValue)
    }
    command = "round:\(id)"
default:
    FileHandle.standardError.write(Data("Unknown command: \(subcommand)\n".utf8))
    exit(ExitCode.badUsage.rawValue)
}

let browser = SyncBrowser(command: command)
browser.run()
