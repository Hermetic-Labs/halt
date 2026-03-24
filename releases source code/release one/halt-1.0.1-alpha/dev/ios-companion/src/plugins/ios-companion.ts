/**
 * HALT iOS Companion - TypeScript Plugin Interfaces
 * 
 * Use these interfaces in your React/TypeScript code to call the native plugins
 * Copy to: frontend/src/plugins/ios-companion.ts
 */

import { registerPlugin } from '@capacitor/core';

// ========================================
// HealthKit Bridge Plugin
// ========================================

export interface HealthKitBridgePlugin {
    // Authorization
    requestAuthorization(): Promise<{ authorized: boolean; message: string }>;
    checkAuthorization(): Promise<{ available: boolean; authorized: boolean; status: string }>;

    // Blood Pressure
    getBloodPressure(options?: { limit?: number }): Promise<{
        readings: Array<{
            systolic: number;
            diastolic: number;
            timestamp: string;
            source: string;
        }>;
        count: number;
    }>;

    // Heart Rate
    getHeartRate(options?: { limit?: number }): Promise<{
        readings: Array<{
            bpm: number;
            timestamp: string;
            source: string;
        }>;
        count: number;
    }>;

    // Oxygen Saturation
    getOxygenSaturation(options?: { limit?: number }): Promise<{
        readings: Array<{
            percentage: number;
            timestamp: string;
            source: string;
        }>;
        count: number;
    }>;

    // Real-time Monitoring
    startHeartRateMonitoring(): Promise<{ monitoring: boolean }>;
    stopHeartRateMonitoring(): Promise<{ monitoring: boolean }>;

    // Summary
    getVitalsSummary(): Promise<{
        vitals: {
            bloodPressure?: { systolic: number; diastolic: number; timestamp: string };
            heartRate?: { bpm: number; timestamp: string };
            oxygenSaturation?: { percentage: number; timestamp: string };
        };
        timestamp: string;
    }>;

    // Event Listeners
    addListener(
        eventName: 'heartRateUpdate',
        listenerFunc: (data: { bpm: number; timestamp: string; source: string }) => void
    ): Promise<{ remove: () => void }>;
}

export const HealthKitBridge = registerPlugin<HealthKitBridgePlugin>('HealthKitBridge');


// ========================================
// EVE Bridge Plugin
// ========================================

export interface EVEBridgePlugin {
    // Connection
    connect(options?: { url?: string }): Promise<{ connected: boolean; url: string }>;
    disconnect(): Promise<{ connected: boolean }>;
    getConnectionStatus(): Promise<{ connected: boolean; serverURL: string; reconnectAttempts: number }>;

    // Messaging
    sendToEVE(options: { type: string; data?: Record<string, any> }): Promise<{ sent: boolean }>;

    // Vitals Sync
    syncVitals(options: { vitals: Record<string, any> }): Promise<{ synced: boolean }>;

    // Workflows
    triggerWorkflow(options: { workflowId: string; parameters?: Record<string, any> }): Promise<{ triggered: boolean }>;

    // Alerts
    sendAlert(options: {
        alertType: string;
        message?: string;
        priority?: 'low' | 'normal' | 'high' | 'critical';
        vitals?: Record<string, any>;
    }): Promise<{ alertSent: boolean }>;

    // Event Listeners
    addListener(
        eventName: 'eveMessage',
        listenerFunc: (data: { type: string; data: any; timestamp: string }) => void
    ): Promise<{ remove: () => void }>;

    addListener(
        eventName: 'eveDisconnected',
        listenerFunc: () => void
    ): Promise<{ remove: () => void }>;

    addListener(
        eventName: 'eveReconnected',
        listenerFunc: (data: { attempt: number }) => void
    ): Promise<{ remove: () => void }>;

    addListener(
        eventName: 'vitalsRequested',
        listenerFunc: () => void
    ): Promise<{ remove: () => void }>;

    addListener(
        eventName: 'pushNotification',
        listenerFunc: (data: any) => void
    ): Promise<{ remove: () => void }>;

    addListener(
        eventName: 'workflowTrigger',
        listenerFunc: (data: any) => void
    ): Promise<{ remove: () => void }>;
}

export const EVEBridge = registerPlugin<EVEBridgePlugin>('EVEBridge');


// ========================================
// Usage Examples
// ========================================

/*
// Example: Initialize and connect

import { HealthKitBridge, EVEBridge } from './plugins/ios-companion';

async function initializeCompanion() {
  // Request HealthKit authorization
  const auth = await HealthKitBridge.requestAuthorization();
  console.log('HealthKit authorized:', auth.authorized);
  
  // Connect to HALT backend
  const connection = await EVEBridge.connect({ url: 'http://192.168.1.100:7778' });
  console.log('Connected to EVE:', connection.connected);
  
  // Set up listeners
  EVEBridge.addListener('vitalsRequested', async () => {
    const vitals = await HealthKitBridge.getVitalsSummary();
    await EVEBridge.syncVitals({ vitals: vitals.vitals });
  });
  
  // Start real-time heart rate monitoring
  await HealthKitBridge.startHeartRateMonitoring();
  
  HealthKitBridge.addListener('heartRateUpdate', async (data) => {
    console.log('Heart rate:', data.bpm);
    await EVEBridge.sendToEVE({
      type: 'heart_rate_reading',
      data: { bpm: data.bpm, timestamp: data.timestamp }
    });
  });
}

// Example: Fetch and display vitals

async function displayVitals() {
  const bp = await HealthKitBridge.getBloodPressure({ limit: 5 });
  const hr = await HealthKitBridge.getHeartRate({ limit: 5 });
  const spo2 = await HealthKitBridge.getOxygenSaturation({ limit: 5 });
  
  console.log('Blood Pressure:', bp.readings);
  console.log('Heart Rate:', hr.readings);
  console.log('SpO2:', spo2.readings);
}

// Example: Send alert

async function sendEmergencyAlert() {
  const vitals = await HealthKitBridge.getVitalsSummary();
  
  await EVEBridge.sendAlert({
    alertType: 'abnormal_vitals',
    message: 'Patient vitals outside normal range',
    priority: 'high',
    vitals: vitals.vitals
  });
}
*/
