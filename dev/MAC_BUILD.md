# macOS & Apple TestFlight Deployment

> [!WARNING]
> **LEGACY ELECTRON ARCHITECTURE DEPRECATED**
> The manual `npm run build:mac` Electron pipeline is obsolete. HALT now uses a **Native Tauri v2** architecture managed autonomously by **GitHub Actions**.

## Automated Cloud Build (GitHub Actions)

You no longer need to physically build the `.dmg` or `.app` on your local MacBook. The `.github/workflows/release.yml` pipeline automatically spawns a `macos-latest` cloud runner whenever you push a Git Release Tag. 

The cloud runner handles compiling both Apple Silicon (`arm64`) and Intel (`x86_64`) native binaries securely, completely isolated from your local machine environment.

### Securing Apple Codesigning (App Store Connect)

To prevent Apple Gatekeeper from blocking the app, and to automatically push builds into Apple TestFlight, the GitHub pipeline requires an **App Store Connect API Key** (`.p8`).

1. Log into your Apple Developer Portal -> App Store Connect.
2. Go to **Users and Access** -> **Integrations** -> **App Store Connect API**.
3. Generate a new API Key with `App Manager` permissions and download the `.p8` file.
4. Go to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
5. Add the following Apple Secure Environment Variables:
   - `APPLE_API_KEY_BASE64`: (The raw text of your `.p8` encoded in Base64)
   - `APPLE_API_KEY_ID`: (The Key ID from the portal)
   - `APPLE_API_ISSUER_ID`: (The Issuer ID from the portal)

Once those keys are injected into GitHub Secrets, the pipeline autonomously assumes your Apple Developer identity, codesigns the `.dmg`, notarizes it against Apple's servers, and uploads it via `fastlane` or `xcrun` directly into TestFlight.

## Local UI Development

For local UI iteration on Mac without compiling the hefty C++ AI backends:

```bash
# Clone the repository
git clone https://github.com/Hermetic-Labs/halt.git
cd halt/viewer

# Install lightweight UI dependencies
npm install

# Run the frontend natively
npm run tauri dev
```

> **Note:** The heavy ML modules (Whisper, CTranslate2) are disabled during fast UI iteration. To compile the full native app locally, use `npm run tauri build --features native_ml`.
