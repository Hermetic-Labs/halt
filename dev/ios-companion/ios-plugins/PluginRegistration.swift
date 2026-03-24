//
//  PluginRegistration.swift
//  HALT Companion
//
//  Register custom Capacitor plugins
//  Copy this into your iOS project after running `npx cap add ios`
//
//  Copyright © 2025 Hermetic Labs, LLC. All rights reserved.
//

import Capacitor

// Add to your AppDelegate.swift application(_:didFinishLaunchingWithOptions:)
// or create a new file in ios/App/App/

public func registerPlugins(on bridge: CAPBridge) {
    // Register HealthKit Bridge
    bridge.registerPluginInstance(HealthKitBridge())
    
    // Register EVE Backend Bridge
    bridge.registerPluginInstance(EVEBridge())
}

// Alternative: If using Capacitor 5+, add to ios/App/App/AppDelegate.swift:
//
// import Capacitor
//
// @main
// class AppDelegate: UIResponder, UIApplicationDelegate {
//     
//     var window: UIWindow?
//     
//     func application(_ application: UIApplication,
//                      didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
//         
//         // Register custom plugins
//         let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge
//         bridge?.registerPluginInstance(HealthKitBridge())
//         bridge?.registerPluginInstance(EVEBridge())
//         
//         return true
//     }
// }
