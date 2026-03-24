# HALT iOS Companion App

> **Innovation ID:** INN-2512-0018-9  
> **Publisher:** Hermetic Labs, LLC

Capacitor-based iOS companion app for HALT with HealthKit integration and real-time vitals sync.

---

## 🍎 Mac Build Instructions (5 Min Setup)

### Prerequisites

- macOS 12+ with Xcode 14+
- Node.js 18+
- Apple Developer account (for device deployment)

### Quick Start

```bash
# 1. Navigate to companion directory
cd installers/ios-companion

# 2. Install dependencies
npm install

# 3. Add iOS platform (generates Xcode project)
npx cap add ios

# 4. Copy Swift plugins to iOS project
cp -r ios-plugins/*.swift ios/App/App/

# 5. Open in Xcode
npx cap open ios
```

### In Xcode

1. **Select your Team** in Signing & Capabilities
2. **Add HealthKit capability** (already configured in entitlements)
3. **Add Background Modes** → Enable "Background fetch"
4. **Build & Run** on your iPhone

---

## 📱 Features

| Feature | Description |
|---------|-------------|
| **HealthKit Integration** | Read BP, HR, SpO2 from Apple Watch |
| **Real-time Sync** | WebSocket connection to HALT backend |
| **Push Notifications** | Receive alerts from EVE workflows |
| **Background Refresh** | Periodic vitals sync |

---

## 🔧 Configuration

### Connect to HALT Backend

Edit `capacitor.config.ts`:

```typescript
server: {
  // Your Mac's IP address running HALT
  url: 'http://192.168.1.100:7778',
}
```

### HealthKit Entitlements

The `ios-plugins/` folder contains pre-configured Swift code. After running `npx cap add ios`, you need to:

1. Enable **HealthKit** in Xcode → Signing & Capabilities
2. Add these keys to `ios/App/App/Info.plist`:

```xml
<key>NSHealthShareUsageDescription</key>
<string>HALT reads health data to monitor your vitals.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>HALT may save health-related information.</string>
```

---

## 📂 Project Structure

```
ios-companion/
├── package.json              # Capacitor dependencies
├── capacitor.config.ts       # iOS/Capacitor configuration
├── ios-plugins/
│   ├── HealthKitBridge.swift # HealthKit data access
│   ├── EVEBridge.swift       # WebSocket to EVE backend
│   └── PluginRegistration.swift
├── src/
│   └── plugins/
│       └── ios-companion.ts  # TypeScript interfaces
└── README.md                 # This file
```

---

## 🔌 Using Plugins in React

```typescript
import { HealthKitBridge, EVEBridge } from './plugins/ios-companion';

// Request HealthKit access
const auth = await HealthKitBridge.requestAuthorization();

// Get blood pressure readings
const bp = await HealthKitBridge.getBloodPressure({ limit: 10 });
console.log(bp.readings);

// Connect to HALT
await EVEBridge.connect({ url: 'http://your-eve-server:7778' });

// Sync vitals
await EVEBridge.syncVitals({ vitals: bp.readings });
```

---

## 🧪 Testing on Device

### Simulator Limitations

- HealthKit has **limited data** in Simulator
- Use a real iPhone + Apple Watch for full testing

### On Real Device

1. Pair your Apple Watch
2. Ensure BP readings exist in Health app
3. Run app and grant HealthKit permissions
4. Vitals will sync to HALT backend

---

## 🚀 Building for App Store

```bash
# Build production bundle
npm run cap:build

# Archive in Xcode
# Product → Archive → Distribute App
```

### Required for App Store Submission

- [ ] Privacy manifest (`PrivacyInfo.xcprivacy`) - included
- [ ] HealthKit entitlements
- [ ] Privacy policy URL
- [ ] App screenshots
- [ ] Medical disclaimer in app description

---

## 📞 Support

**Hermetic Labs, LLC**  
Email: <DwayneTillman@7HermeticLabs.Com>  
Website: <https://7hermeticlabs.com>
