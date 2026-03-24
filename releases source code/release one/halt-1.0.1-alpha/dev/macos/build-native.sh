#!/bin/bash
# HALT Native macOS Executable Build Script
# Builds PyInstaller-based executable with macOS app bundle
set -euo pipefail
# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$SCRIPT_DIR/dist"
BACKEND_DIR="$PROJECT_ROOT/backend"
# Colors
    for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
# No Color
# Logging functions

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" >&2
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}
# Check prerequisites

check_prerequisites() {
    log "Checking prerequisites..."
# Check Python
    if ! command -v
    python3 &> /dev/null;
    then
    error "Python 3 not found"
    exit 1
    fi
    local python_version=$(python3 -c "import sys; print('.'.join(map(str, sys.version_info[:2])))")
    log "Python version: $python_version"
# Check PyInstaller
    if !
    python3 -c "import PyInstaller" 2>/dev/null;
    then
    error "PyInstaller not found. Installing..."
    python3 -m pip install pyinstaller
    fi
# Check pip dependencies
    log "Installing backend dependencies..."
    cd "$BACKEND_DIR"
    python3 -m pip install -r requirements.txt
    cd "$SCRIPT_DIR"
    log "Prerequisites check completed"
}
# Create app icon
    if not exists

create_app_icon() {
    if [[ ! -f "app_icon.icns" ]];
    then
    warn "App icon not found, creating default icon..."
# Create a simple SVG icon as fallback
    cat > app_icon.svg
<< 'EOF' <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"> <rect width="512" height="512"
    fill="#4F46E5"/> <circle cx="256" cy="256" r="120"
    fill="white"/> <text x="256" y="280" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold"
    fill="#4F46E5">EVE</text> </svg>
EOF
# Convert SVG to ICNS (requires imagemagick)
    if command -v convert &> /dev/null;
    then convert app_icon.svg -resize 512x512 app_icon.png iconutil -c icns app_icon.iconset 2>/dev/null ||
    cp app_icon.png app_icon.icns
    else
    warn "ImageMagick not found, using PNG fallback"
    cp app_icon.png app_icon.icns 2>/dev/null ||
    echo "default" > app_icon.icns
    fi
    fi
}
# Clean build directory

clean_build() {
    log "Cleaning build directories..."
    rm -rf "$BUILD_DIR" "$DIST_DIR"
# Clean PyInstaller cache
   
    find . -name "*.pyc" -delete
   
    find . -name "__pycache__" -type d -exec
    rm -rf {} + 2>/dev/null || true
    log "Build directories cleaned"
}
# Build the executable

build_executable() {
    log "Building HALT native executable..."
# Ensure we have the app icon
    create_app_icon
# Run PyInstaller
    python3 -m PyInstaller halt.spec --clean --noconfirm
    log "PyInstaller build completed"
# Check
    if build was successful
    if [[ -d "$DIST_DIR/HALT.app" ]];
    then
    log "App bundle created successfully: $DIST_DIR/HALT.app"
    else
    error "App bundle creation failed"
    exit 1
    fi
}
# Code signing (optional)

sign_app() {
    if [[ -n "${CODE_SIGN_IDENTITY:-}" ]];
    then
    log "Signing app bundle..."
# Sign the app bundle
    codesign --force --deep --sign "$CODE_SIGN_IDENTITY" "$DIST_DIR/HALT.app"
# Verify signature
    codesign --verify --deep --verbose "$DIST_DIR/HALT.app" spctl --assess --verbose "$DIST_DIR/HALT.app"
    log "App bundle signed successfully"
    else
    warn "CODE_SIGN_IDENTITY not set, skipping code signing"
    fi
}
# Create DMG installer

create_dmg() {
    log "Creating DMG installer..."
# Check
    if create-dmg is available
    if ! command -v create-dmg &> /dev/null;
    then
    warn "create-dmg not found, installing..."
    brew install create-dmg ||
    npm install -g create-dmg || {
    warn "Could not install create-dmg, skipping DMG creation" return
}
    fi
# Create DMG create-dmg \ --volname "HALT" \ --volicon "app_icon.icns" \ --window-pos 200 120 \ --window-size 600 300 \ --icon-size 100 \ --icon "HALT.app" 175 120 \ --hide-extension "HALT.app" \ --app-drop-link 425 120 \ --pkg "../scripts/install-native.sh" \ "HALT_$(date +%Y%m%d)_native.dmg" \ "$DIST_DIR/"
    log "DMG installer created"
}
# Notarize app (for distribution)

notarize_app() {
    if [[ -n "${NOTARIZE_APP_ID:-}" && -n "${NOTARIZE_PASSWORD:-}" ]];
    then
    log "Notarizing app bundle..."
# Create ZIP
    for notarization
    zip -r "HALT_$(date +%Y%m%d).zip" "$DIST_DIR/HALT.app"
# Submit
    for notarization
    xcrun notarytool submit "HALT_$(date +%Y%m%d).zip" \ --apple-id "${NOTARIZE_APP_ID}" \ --password "${NOTARIZE_PASSWORD}" \ --team-id "${NOTARIZE_TEAM_ID}" \ --wait
# Staple the notarization
    xcrun stapler staple "$DIST_DIR/HALT.app"
    log "App notarization completed"
    else
    warn "Notarization credentials not set, skipping notarization"
    fi
}
# Run tests

run_tests() {
    log "Running basic tests..."
# Test app bundle structure
    if [[ -d "$DIST_DIR/HALT.app/Contents/MacOS" ]];
    then
    log "[OK] App bundle structure is correct"
    else
    error "[FAIL] App bundle structure is incorrect"
    return 1
    fi
# Test executable permissions
    if [[ -x "$DIST_DIR/HALT.app/Contents/MacOS/halt" ]];
    then
    log "[OK] Executable has correct permissions"
    else
    error "[FAIL] Executable permissions are incorrect"
    return 1
    fi
# Test Info.plist
    if [[ -f "$DIST_DIR/HALT.app/Contents/Info.plist" ]];
    then
    log "[OK] Info.plist exists"
    else
    error "[FAIL] Info.plist is missing"
    return 1
    fi
    log "All basic tests passed"
}
# Create package

create_package() {
    log "Creating installer package..."
# Create package structure
    local pkg_dir="$DIST_DIR/pkg"
    mkdir -p "$pkg_dir/HALT.pkg"
# Copy app bundle
    cp -R "$DIST_DIR/HALT.app" "$pkg_dir/HALT.pkg/"
# Create scripts
    mkdir -p "$pkg_dir/HALT.pkg/Scripts"
    cp ../scripts/install-native.sh "$pkg_dir/HALT.pkg/Scripts/"
# Build package
    pkgbuild --root "$pkg_dir/HALT.pkg" \ --identifier "com.halt.medical" \ --version "1.0.0" \ --install-location "/Applications" \ "$DIST_DIR/HALT_$(date +%Y%m%d)_native.pkg"
    log "Package created: $DIST_DIR/HALT_$(date +%Y%m%d)_native.pkg"
}
# Main build function

main() {
    log "Starting HALT native macOS build"
    log "Project root: $PROJECT_ROOT"
    log "Build directory: $BUILD_DIR"
# Check
    if we're on macOS
    if [[ "$(uname -s)" != "Darwin" ]];
    then
    error "This build script must be run on macOS"
    exit 1
    fi
# Run build steps
    check_prerequisites
    clean_build
    build_executable
    run_tests
# Optional steps
    if [[ "${SKIP_SIGNING:-}" != "true" ]];
    then
    sign_app
    fi
    if [[ "${CREATE_DMG:-}" == "true" ]];
    then
    create_dmg
    fi
    if [[ "${CREATE_PACKAGE:-}" == "true" ]];
    then
    create_package
    fi
    if [[ "${NOTARIZE:-}" == "true" ]];
    then
    notarize_app
    fi
    log "Build completed successfully!"
    log "Output directory: $DIST_DIR"
# Show
    final summary
    echo echo "Build Summary:"
    echo "=============="
    if [[ -d "$DIST_DIR/HALT.app" ]];
    then
    echo "[OK] Native App Bundle: $DIST_DIR/HALT.app"
    fi
    if [[ -f "$DIST_DIR/HALT_$(date +%Y%m%d)_native.dmg" ]];
    then
    echo "[OK] DMG Installer: $DIST_DIR/HALT_$(date +%Y%m%d)_native.dmg"
    fi
    if [[ -f "$DIST_DIR/HALT_$(date +%Y%m%d)_native.pkg" ]];
    then
    echo "[OK] Installer Package: $DIST_DIR/HALT_$(date +%Y%m%d)_native.pkg"
    fi echo
}
# Run
    main function
    main "$@"
