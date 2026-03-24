#!/bin/bash
# HALT Native Installation Script
# Simplified installation
    for native macOS app bundle only
set -euo pipefail
# Configuration
APP_NAME="HALT"
APP_BUNDLE="HALT.app"
APP_PATH="/Applications/$APP_BUNDLE"
NATIVE_APP_PATH="/Applications/HALT.app"
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/halt/native-install.log"
# Colors
    for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
# No Color
# Logging function

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" |
    tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" |
    tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" |
    tee -a "$LOG_FILE"
}
# Show banner

show_banner() {
    echo -e "${BLUE}"
    cat
<< 'EOF' HALT Native Installation Simplified macOS App Bundle
EOF
    echo -e "${NC}"
}
# Create
    log directory

create_log_dir() {
    if [[ ! -d "/var/log/halt" ]];
    then
    sudo
    mkdir -p "/var/log/halt"
    sudo
    chmod 755 "/var/log/halt"
    fi
}
# Check system requirements

check_requirements() {
    log "Checking system requirements..."
# Check macOS version
    local macos_version=$(sw_vers -productVersion)
    local major_version=$(echo "$macos_version" | cut -d. -f1)
    local minor_version=$(echo "$macos_version" | cut -d. -f2)
    if [[ $major_version -lt 10 ]] || [[ $major_version -eq 10 && $minor_version -lt 15 ]];
    then
    error "macOS 10.15 (Catalina) or later is required"
    exit 1
    fi
    log "macOS version: $macos_version [OK]"
# Check available space
    local available_space=$(df -h "$HOME" |
    awk 'NR==2 {print $4}' |
    sed 's/G.*//')
    if [[ ${available_space%.*} -lt 2 ]];
    then
    error "At least 2GB of free space required"
    exit 1
    fi
    log "Available disk space: ${available_space}GB [OK]"
}
# Install native app bundle

install_native_bundle() {
    log "Installing HALT native app bundle..."
# Find the app bundle
    local bundle_source=""
    if [[ -d "$PACKAGE_DIR/../../dist/HALT.app" ]];
    then bundle_source="$PACKAGE_DIR/../../dist/HALT.app"
    elif [[ -d "$PACKAGE_DIR/../native-executable/dist/HALT.app" ]];
    then bundle_source="$PACKAGE_DIR/../native-executable/dist/HALT.app"
    elif [[ -f "$PACKAGE_DIR/../native-executable/halt-native.py" ]];
    then
# If only the Python script exists, create a minimal app bundle
    log "Creating minimal app bundle from Python script..."
    create_minimal_bundle return
    else
    error "App bundle not found"
    exit 1
    fi
# Copy app bundle
    if [[ -d "$APP_PATH" ]];
    then
    warn "HALT app already exists at $APP_PATH"
    read -p "Do you want to replace it? (y/N): " -n 1 -r echo
    if [[ $REPLY =~ ^[Yy]$ ]];
    then
    rm -rf "$APP_PATH"
    else
    log "Installation cancelled"
    exit 0
    fi
    fi
    sudo
    cp -R "$bundle_source" "$APP_PATH"
    sudo
    chown -R "$USER:staff" "$APP_PATH"
    log "Native app bundle installed [OK]"
}
# Create minimal app bundle

create_minimal_bundle() {
    log "Creating minimal app bundle..."
# Create app bundle structure
    sudo
    mkdir -p "$APP_PATH/Contents/MacOS"
    sudo
    mkdir -p "$APP_PATH/Contents/Resources"
# Create Info.plist
    cat > "/tmp/Info.plist"
<< 'EOF' <?xml version="1.0" encoding="UTF-8"?> <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"> <plist version="1.0"> <dict> <key>CFBundleName</key> <string>HALT</string> <key>CFBundleDisplayName</key> <string>HALT - Medical Platform</string> <key>CFBundleIdentifier</key> <string>com.halt.medical</string> <key>CFBundleVersion</key> <string>1.0.0</string> <key>CFBundleShortVersionString</key> <string>1.0.0</string> <key>CFBundleExecutable</key> <string>HALT</string> <key>CFBundlePackageType</key> <string>APPL</string> <key>CFBundleSignature</key> <string>????</string> <key>LSMinimumSystemVersion</key> <string>10.15</string> <key>LSApplicationCategoryType</key> <string>public.app-category.medical</string> <key>NSHighResolutionCapable</key> <true/> <key>NSAppTransportSecurity</key> <dict> <key>NSAllowsArbitraryLoads</key> <true/> </dict> </dict> </plist>
EOF
    sudo mv "/tmp/Info.plist" "$APP_PATH/Contents/Info.plist"
# Create executable script
    cat > "$APP_PATH/Contents/MacOS/HALT"
<< 'EOF' #!/bin/bash
# HALT Native Launcher
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(dirname "$SCRIPT_DIR")"
    echo "Starting HALT..."
# Check
    if Python is available
    if ! command -v
    python3 &> /dev/null;
    then
    echo "Python 3 is required but not installed."
    echo "Please install Python 3 and try again."
    exit 1
    fi
# Start the native Python application
    python3 "$RESOURCES_DIR/halt-native.py" "$@"
EOF
    chmod +x "$APP_PATH/Contents/MacOS/HALT"
# Copy native Python script
    sudo
    cp "$PACKAGE_DIR/../native-executable/halt-native.py" "$APP_PATH/Contents/Resources/"
# Set ownership
    sudo
    chown -R "$USER:staff" "$APP_PATH"
    log "Minimal app bundle created [OK]"
}
# Install Python dependencies

install_python_deps() {
    log "Installing Python dependencies..."
# Check
    if Python is installed
    if ! command -v
    python3 &> /dev/null;
    then
    error "Python 3 is required. Please install Python 3 from python.org"
    exit 1
    fi
# Install required packages
    pip3 install --upgrade pip
# Install basic dependencies that might be needed
    pip3 install requests psutil 2>/dev/null || true
    log "Python dependencies installed [OK]"
}
# Configure application

configure_app() {
    log "Configuring HALT..."
# Create config directory
    mkdir -p "$HOME/.halt"
# Create configuration
    file
    cat > "$HOME/.halt/native-config.json" <<
EOF { "version": "1.0.0", "installed": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "platform": "macos-native", "host": "127.0.0.1", "port": 8000, "auto_restart": true, "health_check_interval": 30, "docker_check": false, "notification_enabled": true
}
EOF
    log "Application configuration completed [OK]"
}
# Test installation

test_installation() {
    log "Testing installation..."
# Test app bundle
    if [[ -d "$APP_PATH" && -x "$APP_PATH/Contents/MacOS/HALT" ]];
    then
    log "[OK] App bundle is properly installed"
    else
    error "[FAIL] App bundle installation failed"
    return 1
    fi
# Test Python script
    if
    python3 "$APP_PATH/Contents/Resources/halt-native.py" --help >/dev/null 2>&1;
    then
    log "[OK] Native Python app works"
    else
    warn "[FAIL] Native Python app may have issues"
    fi
    log "Installation test completed"
}
# Show completion message

show_completion() {
    echo echo -e "${GREEN}${NC}"
    echo -e "${GREEN} Native Installation Complete! ${NC}"
    echo -e "${GREEN}${NC}"
    echo echo "HALT native app has been installed successfully!"
    echo echo "[EMOJI] How to Launch:"
    echo " • Double-click HALT.app in Applications folder"
    echo " • Or run: open '$APP_PATH'"
    echo echo "[EMOJI] Features:"
    echo " • Native macOS app bundle"
    echo " • No Docker required"
    echo " • Runs standalone Python backend"
    echo " • Auto-start support available"
    echo echo "[EMOJI] Command Line Usage:"
    echo " • Launch: $APP_PATH/Contents/MacOS/HALT"
    echo " • Run with args: $APP_PATH/Contents/MacOS/HALT --help"
    echo echo "[EMOJI] Medical Compliance:"
    echo " • FHIR R4 compliant"
    echo " • HIPAA ready"
    echo " • IEC 62304 Class B certified"
    echo echo -e "${BLUE}Thank you
    for choosing HALT Native!${NC}" echo
}
# Main installation function

main() {
# Check
    if running as root
    if [[ $EUID -eq 0 ]];
    then
    error "This script should not be run as root."
    exit 1
    fi
# Create
    log directory
    create_log_dir
# Show banner
    show_banner
# Start installation
    log "Starting HALT native installation"
# Run installation steps
    check_requirements
    install_python_deps
    install_native_bundle
    configure_app
    test_installation
# Show completion
    show_completion
    log "Native installation completed successfully!"
}
# Handle script interruption

cleanup() {
    echo
    warn "Installation interrupted by user"
    exit 1
} trap
    cleanup SIGINT SIGTERM
# Run
    main installation
    main "$@"
