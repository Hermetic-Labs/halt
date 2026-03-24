//
//  EVEBridge.swift
//  HALT Companion
//
//  WebSocket bridge for real-time communication with HALT backend
//  Innovation ID: INN-2512-0018-9
//
//  Copyright © 2025 Hermetic Labs, LLC. All rights reserved.
//

import Foundation
import Capacitor

@objc(EVEBridge)
public class EVEBridge: CAPPlugin {
    
    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var serverURL: String = "ws://localhost:7778"
    private var isConnected = false
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    
    // MARK: - Connection Management
    
    @objc func connect(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? serverURL
        serverURL = url
        
        guard let wsURL = URL(string: url.replacingOccurrences(of: "http", with: "ws") + "/ws/companion") else {
            call.reject("Invalid WebSocket URL")
            return
        }
        
        urlSession = URLSession(configuration: .default)
        webSocket = urlSession?.webSocketTask(with: wsURL)
        
        webSocket?.resume()
        isConnected = true
        reconnectAttempts = 0
        
        // Start receiving messages
        receiveMessage()
        
        // Send connection confirmation
        sendMessage(type: "companion_connected", data: [
            "device": UIDevice.current.name,
            "model": UIDevice.current.model,
            "systemVersion": UIDevice.current.systemVersion,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
        
        call.resolve([
            "connected": true,
            "url": url
        ])
    }
    
    @objc func disconnect(_ call: CAPPluginCall) {
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        isConnected = false
        
        call.resolve(["connected": false])
    }
    
    @objc func getConnectionStatus(_ call: CAPPluginCall) {
        call.resolve([
            "connected": isConnected,
            "serverURL": serverURL,
            "reconnectAttempts": reconnectAttempts
        ])
    }
    
    // MARK: - Message Handling
    
    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleTextMessage(text)
                case .data(let data):
                    self?.handleDataMessage(data)
                @unknown default:
                    break
                }
                
                // Continue receiving
                self?.receiveMessage()
                
            case .failure(let error):
                print("WebSocket receive error: \(error)")
                self?.handleDisconnection()
            }
        }
    }
    
    private func handleTextMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        
        let messageType = json["type"] as? String ?? "unknown"
        let payload = json["data"] as? [String: Any] ?? [:]
        
        // Notify JavaScript side
        notifyListeners("eveMessage", data: [
            "type": messageType,
            "data": payload,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
        
        // Handle specific message types
        switch messageType {
        case "request_vitals":
            handleVitalsRequest()
        case "push_notification":
            handlePushNotification(payload)
        case "workflow_trigger":
            handleWorkflowTrigger(payload)
        default:
            break
        }
    }
    
    private func handleDataMessage(_ data: Data) {
        // Handle binary data if needed
    }
    
    private func handleDisconnection() {
        isConnected = false
        notifyListeners("eveDisconnected", data: [:])
        
        // Attempt reconnection
        if reconnectAttempts < maxReconnectAttempts {
            reconnectAttempts += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(reconnectAttempts * 2)) { [weak self] in
                self?.attemptReconnect()
            }
        }
    }
    
    private func attemptReconnect() {
        guard let url = URL(string: serverURL.replacingOccurrences(of: "http", with: "ws") + "/ws/companion") else {
            return
        }
        
        webSocket = urlSession?.webSocketTask(with: url)
        webSocket?.resume()
        isConnected = true
        receiveMessage()
        
        notifyListeners("eveReconnected", data: [
            "attempt": reconnectAttempts
        ])
    }
    
    // MARK: - Send Messages
    
    @objc func sendToEVE(_ call: CAPPluginCall) {
        guard let type = call.getString("type") else {
            call.reject("Message type is required")
            return
        }
        
        let data = call.getObject("data") ?? [:]
        
        sendMessage(type: type, data: data)
        call.resolve(["sent": true])
    }
    
    private func sendMessage(type: String, data: [String: Any]) {
        let message: [String: Any] = [
            "type": type,
            "data": data,
            "source": "ios_companion",
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: message),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return
        }
        
        webSocket?.send(.string(jsonString)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }
    
    // MARK: - Vitals Sync
    
    @objc func syncVitals(_ call: CAPPluginCall) {
        guard let vitals = call.getObject("vitals") else {
            call.reject("Vitals data is required")
            return
        }
        
        sendMessage(type: "vitals_update", data: [
            "vitals": vitals,
            "device": UIDevice.current.name
        ])
        
        call.resolve(["synced": true])
    }
    
    private func handleVitalsRequest() {
        // Request fresh vitals from HealthKit bridge
        notifyListeners("vitalsRequested", data: [:])
    }
    
    // MARK: - Push Notifications
    
    private func handlePushNotification(_ payload: [String: Any]) {
        notifyListeners("pushNotification", data: payload)
    }
    
    // MARK: - Workflow Integration
    
    private func handleWorkflowTrigger(_ payload: [String: Any]) {
        notifyListeners("workflowTrigger", data: payload)
    }
    
    @objc func triggerWorkflow(_ call: CAPPluginCall) {
        guard let workflowId = call.getString("workflowId") else {
            call.reject("Workflow ID is required")
            return
        }
        
        let parameters = call.getObject("parameters") ?? [:]
        
        sendMessage(type: "execute_workflow", data: [
            "workflowId": workflowId,
            "parameters": parameters
        ])
        
        call.resolve(["triggered": true])
    }
    
    // MARK: - Alert/Emergency
    
    @objc func sendAlert(_ call: CAPPluginCall) {
        guard let alertType = call.getString("alertType") else {
            call.reject("Alert type is required")
            return
        }
        
        let message = call.getString("message") ?? ""
        let priority = call.getString("priority") ?? "normal"
        let vitals = call.getObject("vitals") ?? [:]
        
        sendMessage(type: "companion_alert", data: [
            "alertType": alertType,
            "message": message,
            "priority": priority,
            "vitals": vitals,
            "location": getDeviceLocation()
        ])
        
        call.resolve(["alertSent": true])
    }
    
    private func getDeviceLocation() -> [String: Any] {
        // In production, would use CoreLocation
        return [
            "available": false,
            "reason": "Location services not implemented"
        ]
    }
}
