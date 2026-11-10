import Foundation
import MultipeerConnectivity

// MARK: - Exit codes

enum ExitCode: Int32 {
    case success = 0
    case notFound = 1
    case transferError = 2
    case badUsage = 3
}

// MARK: - Status messages (parsed by Rust backend)

func emitStatus(_ status: String, detail: String? = nil) {
    let msg = detail != nil ? "STATUS:\(status):\(detail!)\n" : "STATUS:\(status)\n"
    FileHandle.standardError.write(Data(msg.utf8))
}

// MARK: - Sync Browser

final class SyncBrowser: NSObject, MCNearbyServiceBrowserDelegate, MCSessionDelegate {
    private let serviceType = "gobirdie"
    private let peerID = MCPeerID(displayName: "GoBirdie-Desktop")
    private let session: MCSession
    private let browser: MCNearbyServiceBrowser
    private let mode: Mode
    private let discoveryTimeoutSeconds: TimeInterval = 15
    private let connectionTimeoutSeconds: TimeInterval = 60
    private let transferTimeoutSeconds: TimeInterval = 120
    private var timeoutWorkItem: DispatchWorkItem?
    private var peerFound = false
    private var isConnected = false
    private var connectedPeer: MCPeerID?
    
    // For sync mode
    private var roundIds: [String] = []
    private var currentRoundIndex = 0
    private var results: [String: String] = [:]  // id -> JSON
    private var listJson: String?

    enum Mode {
        case list
        case round(String)
        case sync  // New: fetch list + all rounds in one connection
    }

    init(mode: Mode) {
        self.mode = mode
        session = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .none)
        browser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
        super.init()
        session.delegate = self
        browser.delegate = self
    }

    func run() {
        emitStatus("SEARCHING")
        browser.startBrowsingForPeers()
        scheduleTimeout(seconds: discoveryTimeoutSeconds, message: "Timeout: iPhone not found")
        RunLoop.main.run()
    }

    private func scheduleTimeout(seconds: TimeInterval, message: String) {
        timeoutWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self, !self.isConnected else { return }
            FileHandle.standardError.write(Data("\(message)\n".utf8))
            exit(ExitCode.notFound.rawValue)
        }
        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: workItem)
    }

    private func cancelTimeout() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
    }

    // MARK: - MCNearbyServiceBrowserDelegate

    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard !peerFound else { return }
        peerFound = true
        cancelTimeout()
        emitStatus("FOUND", detail: peerID.displayName)
        emitStatus("CONNECTING")
        scheduleTimeout(seconds: connectionTimeoutSeconds, message: "Timeout: Connection failed")
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 30)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        FileHandle.standardError.write(Data("Browse failed: \(error.localizedDescription)\n".utf8))
        exit(ExitCode.transferError.rawValue)
    }

    // MARK: - MCSessionDelegate

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        switch state {
        case .connecting:
            break
        case .connected:
            isConnected = true
            connectedPeer = peerID
            cancelTimeout()
            emitStatus("CONNECTED", detail: peerID.displayName)
            browser.stopBrowsingForPeers()
            scheduleTimeout(seconds: transferTimeoutSeconds, message: "Timeout: Data transfer took too long")
            sendNextCommand()
        case .notConnected:
            if isConnected {
                FileHandle.standardError.write(Data("Connection lost\n".utf8))
                exit(ExitCode.transferError.rawValue)
            }
        @unknown default:
            break
        }
    }

    private func sendNextCommand() {
        guard let peer = connectedPeer else { return }
        
        let command: String
        switch mode {
        case .list:
            command = "list"
            emitStatus("DOWNLOADING")
        case .round(let id):
            command = "round:\(id)"
            emitStatus("DOWNLOADING")
        case .sync:
            if listJson == nil {
                // First: get list
                command = "list"
                emitStatus("DOWNLOADING", detail: "list")
            } else if currentRoundIndex < roundIds.count {
                // Then: get each round
                let id = roundIds[currentRoundIndex]
                command = "round:\(id)"
                emitStatus("DOWNLOADING", detail: "\(currentRoundIndex + 1)/\(roundIds.count)")
            } else {
                // Done - output all results
                finishSync()
                return
            }
        }

        guard let data = command.data(using: .utf8) else {
            exit(ExitCode.transferError.rawValue)
        }
        do {
            try session.send(data, toPeers: [peer], with: .reliable)
        } catch {
            FileHandle.standardError.write(Data("Send failed: \(error.localizedDescription)\n".utf8))
            exit(ExitCode.transferError.rawValue)
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        cancelTimeout()
        scheduleTimeout(seconds: transferTimeoutSeconds, message: "Timeout: Data transfer took too long")
        
        let json = String(data: data, encoding: .utf8) ?? ""
        
        switch mode {
        case .list, .round:
            // Single command mode - just output and exit
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            exit(ExitCode.success.rawValue)
            
        case .sync:
            if listJson == nil {
                // Received list - parse round IDs
                listJson = json
                if let listData = json.data(using: .utf8),
                   let list = try? JSONSerialization.jsonObject(with: listData) as? [[String: Any]] {
                    roundIds = list.compactMap { $0["id"] as? String }
                    emitStatus("LIST", detail: "\(roundIds.count)")
                }
                sendNextCommand()
            } else {
                // Received a round
                let id = roundIds[currentRoundIndex]
                results[id] = json
                currentRoundIndex += 1
                sendNextCommand()
            }
        }
    }

    private func finishSync() {
        cancelTimeout()
        // Output format: {"list": [...], "rounds": {"id1": {...}, "id2": {...}}}
        var output: [String: Any] = [:]
        if let listJson = listJson, let listData = listJson.data(using: .utf8),
           let list = try? JSONSerialization.jsonObject(with: listData) {
            output["list"] = list
        }
        var rounds: [String: Any] = [:]
        for (id, json) in results {
            if let data = json.data(using: .utf8),
               let round = try? JSONSerialization.jsonObject(with: data) {
                rounds[id] = round
            }
        }
        output["rounds"] = rounds
        
        if let outputData = try? JSONSerialization.data(withJSONObject: output),
           let outputStr = String(data: outputData, encoding: .utf8) {
            FileHandle.standardOutput.write(Data(outputStr.utf8))
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
        
        // Exit on main thread to ensure clean shutdown
        DispatchQueue.main.async {
            exit(ExitCode.success.rawValue)
        }
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

// MARK: - Main

let args = CommandLine.arguments.dropFirst()

guard let subcommand = args.first else {
    FileHandle.standardError.write(Data("Usage: gobirdie-sync-helper list | round <id> | sync\n".utf8))
    exit(ExitCode.badUsage.rawValue)
}

let mode: SyncBrowser.Mode
switch subcommand {
case "list":
    mode = .list
case "round":
    guard let id = args.dropFirst().first else {
        FileHandle.standardError.write(Data("Usage: gobirdie-sync-helper round <id>\n".utf8))
        exit(ExitCode.badUsage.rawValue)
    }
    mode = .round(id)
case "sync":
    mode = .sync
default:
    FileHandle.standardError.write(Data("Unknown command: \(subcommand)\n".utf8))
    exit(ExitCode.badUsage.rawValue)
}

let browser = SyncBrowser(mode: mode)
browser.run()
