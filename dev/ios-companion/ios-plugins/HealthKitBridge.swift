//
//  HealthKitBridge.swift
//  HALT Companion
//
//  HealthKit integration for reading vitals from Apple Watch/iPhone
//  Innovation ID: INN-2512-0018-9
//
//  Copyright © 2025 Hermetic Labs, LLC. All rights reserved.
//

import Foundation
import HealthKit
import Capacitor

@objc(HealthKitBridge)
public class HealthKitBridge: CAPPlugin {
    
    private let healthStore = HKHealthStore()
    
    // MARK: - Health Data Types
    
    private let readTypes: Set<HKObjectType> = {
        var types = Set<HKObjectType>()
        
        // Vital Signs
        if let systolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic) {
            types.insert(systolic)
        }
        if let diastolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) {
            types.insert(diastolic)
        }
        if let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let oxygenSaturation = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) {
            types.insert(oxygenSaturation)
        }
        if let respiratoryRate = HKQuantityType.quantityType(forIdentifier: .respiratoryRate) {
            types.insert(respiratoryRate)
        }
        if let bodyTemperature = HKQuantityType.quantityType(forIdentifier: .bodyTemperature) {
            types.insert(bodyTemperature)
        }
        
        // Activity
        if let steps = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(steps)
        }
        if let distance = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            types.insert(distance)
        }
        if let activeEnergy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            types.insert(activeEnergy)
        }
        
        // Sleep
        if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleep)
        }
        
        return types
    }()
    
    // MARK: - Authorization
    
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
            DispatchQueue.main.async {
                if success {
                    call.resolve([
                        "authorized": true,
                        "message": "HealthKit authorization granted"
                    ])
                } else {
                    call.reject("HealthKit authorization denied: \(error?.localizedDescription ?? "Unknown error")")
                }
            }
        }
    }
    
    @objc func checkAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "authorized": false])
            return
        }
        
        // Check authorization for heart rate as a proxy for general health data
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.resolve(["available": true, "authorized": false])
            return
        }
        
        let status = healthStore.authorizationStatus(for: heartRateType)
        call.resolve([
            "available": true,
            "authorized": status == .sharingAuthorized,
            "status": self.authorizationStatusString(status)
        ])
    }
    
    private func authorizationStatusString(_ status: HKAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .sharingDenied: return "denied"
        case .sharingAuthorized: return "authorized"
        @unknown default: return "unknown"
        }
    }
    
    // MARK: - Blood Pressure
    
    @objc func getBloodPressure(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 10
        
        guard let systolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic),
              let diastolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) else {
            call.reject("Blood pressure types not available")
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        // Query systolic first
        let systolicQuery = HKSampleQuery(
            sampleType: systolicType,
            predicate: nil,
            limit: limit,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, error in
            guard let samples = samples as? [HKQuantitySample], error == nil else {
                call.reject("Failed to fetch blood pressure: \(error?.localizedDescription ?? "Unknown")")
                return
            }
            
            // Now query diastolic
            let diastolicQuery = HKSampleQuery(
                sampleType: diastolicType,
                predicate: nil,
                limit: limit,
                sortDescriptors: [sortDescriptor]
            ) { _, diastolicSamples, diastolicError in
                DispatchQueue.main.async {
                    let diastolicMap = Dictionary(
                        uniqueKeysWithValues: (diastolicSamples as? [HKQuantitySample] ?? [])
                            .map { ($0.startDate, $0.quantity.doubleValue(for: .millimeterOfMercury())) }
                    )
                    
                    let readings = samples.map { sample -> [String: Any] in
                        let systolicValue = sample.quantity.doubleValue(for: .millimeterOfMercury())
                        let diastolicValue = diastolicMap[sample.startDate] ?? 0
                        
                        return [
                            "systolic": Int(systolicValue),
                            "diastolic": Int(diastolicValue),
                            "timestamp": ISO8601DateFormatter().string(from: sample.startDate),
                            "source": sample.sourceRevision.source.name
                        ]
                    }
                    
                    call.resolve([
                        "readings": readings,
                        "count": readings.count
                    ])
                }
            }
            
            self?.healthStore.execute(diastolicQuery)
        }
        
        healthStore.execute(systolicQuery)
    }
    
    // MARK: - Heart Rate
    
    @objc func getHeartRate(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 10
        
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.reject("Heart rate type not available")
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        let query = HKSampleQuery(
            sampleType: heartRateType,
            predicate: nil,
            limit: limit,
            sortDescriptors: [sortDescriptor]
        ) { _, samples, error in
            DispatchQueue.main.async {
                guard let samples = samples as? [HKQuantitySample], error == nil else {
                    call.reject("Failed to fetch heart rate: \(error?.localizedDescription ?? "Unknown")")
                    return
                }
                
                let readings = samples.map { sample -> [String: Any] in
                    let value = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                    return [
                        "bpm": Int(value),
                        "timestamp": ISO8601DateFormatter().string(from: sample.startDate),
                        "source": sample.sourceRevision.source.name
                    ]
                }
                
                call.resolve([
                    "readings": readings,
                    "count": readings.count
                ])
            }
        }
        
        healthStore.execute(query)
    }
    
    // MARK: - Oxygen Saturation
    
    @objc func getOxygenSaturation(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 10
        
        guard let spO2Type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) else {
            call.reject("Oxygen saturation type not available")
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        let query = HKSampleQuery(
            sampleType: spO2Type,
            predicate: nil,
            limit: limit,
            sortDescriptors: [sortDescriptor]
        ) { _, samples, error in
            DispatchQueue.main.async {
                guard let samples = samples as? [HKQuantitySample], error == nil else {
                    call.reject("Failed to fetch SpO2: \(error?.localizedDescription ?? "Unknown")")
                    return
                }
                
                let readings = samples.map { sample -> [String: Any] in
                    let value = sample.quantity.doubleValue(for: .percent()) * 100
                    return [
                        "percentage": Int(value),
                        "timestamp": ISO8601DateFormatter().string(from: sample.startDate),
                        "source": sample.sourceRevision.source.name
                    ]
                }
                
                call.resolve([
                    "readings": readings,
                    "count": readings.count
                ])
            }
        }
        
        healthStore.execute(query)
    }
    
    // MARK: - Real-time Monitoring
    
    private var heartRateObserverQuery: HKObserverQuery?
    
    @objc func startHeartRateMonitoring(_ call: CAPPluginCall) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.reject("Heart rate type not available")
            return
        }
        
        // Stop any existing observer
        if let existingQuery = heartRateObserverQuery {
            healthStore.stop(existingQuery)
        }
        
        heartRateObserverQuery = HKObserverQuery(
            sampleType: heartRateType,
            predicate: nil
        ) { [weak self] _, completionHandler, error in
            if error != nil {
                return
            }
            
            // Fetch the latest reading
            self?.fetchLatestHeartRate { reading in
                if let reading = reading {
                    self?.notifyListeners("heartRateUpdate", data: reading)
                }
            }
            
            completionHandler()
        }
        
        if let query = heartRateObserverQuery {
            healthStore.execute(query)
            call.resolve(["monitoring": true])
        } else {
            call.reject("Failed to start heart rate monitoring")
        }
    }
    
    @objc func stopHeartRateMonitoring(_ call: CAPPluginCall) {
        if let query = heartRateObserverQuery {
            healthStore.stop(query)
            heartRateObserverQuery = nil
        }
        call.resolve(["monitoring": false])
    }
    
    private func fetchLatestHeartRate(completion: @escaping ([String: Any]?) -> Void) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            completion(nil)
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        let query = HKSampleQuery(
            sampleType: heartRateType,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sortDescriptor]
        ) { _, samples, _ in
            guard let sample = samples?.first as? HKQuantitySample else {
                completion(nil)
                return
            }
            
            let value = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            
            completion([
                "bpm": Int(value),
                "timestamp": ISO8601DateFormatter().string(from: sample.startDate),
                "source": sample.sourceRevision.source.name
            ])
        }
        
        healthStore.execute(query)
    }
    
    // MARK: - Get All Vitals Summary
    
    @objc func getVitalsSummary(_ call: CAPPluginCall) {
        var summary: [String: Any] = [:]
        let group = DispatchGroup()
        
        // Blood Pressure
        group.enter()
        getLatestBloodPressure { bp in
            if let bp = bp {
                summary["bloodPressure"] = bp
            }
            group.leave()
        }
        
        // Heart Rate
        group.enter()
        fetchLatestHeartRate { hr in
            if let hr = hr {
                summary["heartRate"] = hr
            }
            group.leave()
        }
        
        // Oxygen Saturation
        group.enter()
        getLatestOxygenSaturation { spo2 in
            if let spo2 = spo2 {
                summary["oxygenSaturation"] = spo2
            }
            group.leave()
        }
        
        group.notify(queue: .main) {
            call.resolve([
                "vitals": summary,
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ])
        }
    }
    
    private func getLatestBloodPressure(completion: @escaping ([String: Any]?) -> Void) {
        guard let systolicType = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic) else {
            completion(nil)
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        let query = HKSampleQuery(
            sampleType: systolicType,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sortDescriptor]
        ) { _, samples, _ in
            guard let sample = samples?.first as? HKQuantitySample else {
                completion(nil)
                return
            }
            
            let systolic = Int(sample.quantity.doubleValue(for: .millimeterOfMercury()))
            
            completion([
                "systolic": systolic,
                "diastolic": 80, // Will be fetched separately in production
                "timestamp": ISO8601DateFormatter().string(from: sample.startDate)
            ])
        }
        
        healthStore.execute(query)
    }
    
    private func getLatestOxygenSaturation(completion: @escaping ([String: Any]?) -> Void) {
        guard let spO2Type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) else {
            completion(nil)
            return
        }
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        
        let query = HKSampleQuery(
            sampleType: spO2Type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [sortDescriptor]
        ) { _, samples, _ in
            guard let sample = samples?.first as? HKQuantitySample else {
                completion(nil)
                return
            }
            
            let value = Int(sample.quantity.doubleValue(for: .percent()) * 100)
            
            completion([
                "percentage": value,
                "timestamp": ISO8601DateFormatter().string(from: sample.startDate)
            ])
        }
        
        healthStore.execute(query)
    }
}
