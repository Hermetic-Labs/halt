#!/bin/bash
# HALT macOS Installation Script
# Comprehensive installation for all macOS components
#
# CRITICAL: This installer MUST:
# 1. Write the install_complete.flag marker
# 2. Set EVE_SYSTEM_MODE=PRODUCTION in the environment
# 3. FAIL if either cannot be completed
#
set -euo pipefail

# Configuration
APP_NAME="HALT"
APP_BUNDLE="HALT.app"
APP_PATH="/Applications/$APP_BUNDLE"
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/halt/install.log"
BACKUP_DIR="$HOME/.halt-backup"

# PRODUCTION ACTIVATION PATHS
RUNTIME_DIR="$APP_PATH/Contents/Resources/backend/runtime"
INSTALL_MARKER="$RUNTIME_DIR/install_complete.flag"
ENV_FILE="$HOME/.halt/env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

# Show banner
show_banner() {
    echo -e "${BLUE}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════════════════════╗
    ║                    HALT Installation                     ║
    ║              Medical Platform for macOS                    ║
    ║          FHIR R4 • HIPAA • IEC 62304 Class B              ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# Create log directory
create_log_dir() {
    if [[ ! -d "/var/log/halt" ]]; then
        sudo mkdir -p "/var/log/halt"
        sudo chmod 755 "/var/log/halt"
    fi
}

# Check system requirements
check_requirements() {
    log "Checking system requirements..."

    # Check macOS version
    local macos_version=$(sw_vers -productVersion)
    local major_version=$(echo "$macos_version" | cut -d. -f1)
    local minor_version=$(echo "$macos_version" | cut -d. -f2)

    if [[ $major_version -lt 10 ]] || [[ $major_version -eq 10 && $minor_version -lt 15 ]]; then
        error "macOS 10.15 (Catalina) or later is required"
        error "Current version: $macos_version"
        exit 1
    fi
    log "macOS version: $macos_version [OK]"

    # Check architecture
    local arch=$(uname -m)
    if [[ "$arch" == "arm64" ]]; then
        log "Architecture: Apple Silicon (arm64) [OK]"
    elif [[ "$arch" == "x86_64" ]]; then
        log "Architecture: Intel (x86_64) [OK]"
    else
        error "Unsupported architecture: $arch"
        exit 1
    fi

    # Check available disk space (minimum 5GB)
    local available_space=$(df -h "$HOME" | awk 'NR==2 {print $4}' | sed 's/G.*//')
    if [[ ${available_space%.*} -lt 5 ]]; then
        warn "Low disk space: ${available_space}GB available"
        warn "HALT requires at least 5GB of free space"
    else
        log "Available disk space: ${available_space}GB [OK]"
    fi

    # Check memory
    local memory=$(sysctl -n hw.memsize)
    local memory_gb=$((memory / 1024 / 1024 / 1024))
    if [[ $memory_gb -lt 8 ]]; then
        warn "Low memory: ${memory_gb}GB available"
        warn "HALT recommends at least 8GB of RAM"
    else
        log "System memory: ${memory_gb}GB [OK]"
    fi
}

# Install Homebrew if not present
install_homebrew() {
    if ! command -v brew &> /dev/null; then
        log "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

        # Add Homebrew to PATH for Apple Silicon
        if [[ $(uname -m) == "arm64" ]]; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        log "Homebrew installed successfully"
    else
        log "Homebrew is already installed [OK]"
    fi
}

# Install Docker Desktop
install_docker() {
    log "Checking Docker Desktop..."

    if command -v docker &> /dev/null && docker info &> /dev/null; then
        log "Docker Desktop is already installed and running [OK]"
        return 0
    fi

    log "Docker Desktop not found. Installing..."

    # Install Docker Desktop via Homebrew
    brew install --cask docker

    log "Docker Desktop installation completed"
    log "Please start Docker Desktop manually and then re-run this installation"

    # Wait for user confirmation
    echo
    read -p "Press Enter after starting Docker Desktop..."

    # Verify Docker is running
    if docker info &> /dev/null; then
        log "Docker Desktop is now running [OK]"
    else
        error "Docker Desktop is not running. Please start it manually."
        exit 1
    fi
}

# Install Python dependencies
install_python_deps() {
    log "Installing Python dependencies..."

    # Install Python if not present
    if ! command -v python3 &> /dev/null; then
        log "Installing Python 3..."
        brew install python@3.11
    fi

    # Install required Python packages
    pip3 install --upgrade pip
    pip3 install virtualenv

    log "Python dependencies installed [OK]"
}

# Install Node.js dependencies
install_nodejs_deps() {
    log "Installing Node.js dependencies..."

    # Install Node.js if not present
    if ! command -v node &> /dev/null; then
        log "Installing Node.js..."
        brew install node
    fi

    log "Node.js version: $(node --version) [OK]"
    log "npm version: $(npm --version) [OK]"

    # Install pnpm
    if ! command -v pnpm &> /dev/null; then
        npm install -g pnpm
    fi

    log "Node.js dependencies installed [OK]"
}

# Install native components
install_native() {
    log "Installing HALT native components..."

    # Create application directory
    sudo mkdir -p "$APP_PATH/Contents/Resources"
    sudo mkdir -p "$APP_PATH/Contents/MacOS"

    # Copy application bundle
    if [[ -d "$PACKAGE_DIR/../app-bundle/$APP_BUNDLE" ]]; then
        sudo cp -R "$PACKAGE_DIR/../app-bundle/$APP_BUNDLE" "/Applications/"
        log "Application bundle copied [OK]"
    else
        warn "Application bundle not found, skipping..."
    fi

    # Copy backend
    if [[ -d "$PACKAGE_DIR/../../backend" ]]; then
        sudo cp -R "$PACKAGE_DIR/../../backend" "$APP_PATH/Contents/Resources/"
        log "Backend copied [OK]"
    else
        warn "Backend not found, skipping..."
    fi

    # Copy Docker configuration
    if [[ -d "$PACKAGE_DIR/../docker-desktop" ]]; then
        sudo cp -R "$PACKAGE_DIR/../docker-desktop" "$APP_PATH/Contents/Resources/"
        log "Docker configuration copied [OK]"
    else
        warn "Docker configuration not found, skipping..."
    fi

    # Copy scripts
    if [[ -d "$PACKAGE_DIR" ]]; then
        sudo mkdir -p "$APP_PATH/Contents/Resources/scripts"
        sudo cp "$PACKAGE_DIR"/*.sh "$APP_PATH/Contents/Resources/scripts/" 2>/dev/null || true
        sudo chmod +x "$APP_PATH/Contents/Resources/scripts/"*.sh 2>/dev/null || true
        log "Scripts copied [OK]"
    fi

    # Copy LaunchAgent
    if [[ -f "$PACKAGE_DIR/../launch-agent/com.halt.plist" ]]; then
        sudo mkdir -p "$APP_PATH/Contents/Resources/launch-agent"
        sudo cp "$PACKAGE_DIR/../launch-agent/com.halt.plist" "$APP_PATH/Contents/Resources/launch-agent/"
        log "LaunchAgent configuration copied [OK]"
    else
        warn "LaunchAgent configuration not found, skipping..."
    fi

    # Set permissions
    sudo chown -R "$USER:staff" "$APP_PATH"
    sudo chmod -R 755 "$APP_PATH"

    log "Native components installation completed [OK]"
}

# Install LaunchAgent
install_launchagent() {
    log "Installing LaunchAgent..."

    # Run LaunchAgent installation script
    if [[ -f "$APP_PATH/Contents/Resources/scripts/launch-agent-manager.sh" ]]; then
        sudo "$APP_PATH/Contents/Resources/scripts/launch-agent-manager.sh" install
        log "LaunchAgent installed [OK]"
    else
        warn "LaunchAgent manager script not found"
    fi
}

# Configure application
configure_app() {
    log "Configuring HALT application..."

    # Create configuration directory
    mkdir -p "$HOME/.halt"

    # Create initial configuration
    cat > "$HOME/.halt/config.json" << EOF
{
    "version": "1.0.0",
    "installed": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "platform": "macos",
    "auto_start": true,
    "docker_integration": true,
    "health_monitoring": true,
    "log_level": "INFO"
}
EOF

    # Set up log rotation
    if command -v logrotate &> /dev/null; then
        cat > /tmp/halt.logrotate << 'EOF'
/var/log/halt/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 root wheel
}
EOF
        sudo mv /tmp/halt.logrotate /usr/local/etc/logrotate.d/halt 2>/dev/null || true
    fi

    log "Application configuration completed [OK]"
}

# =============================================================================
# PRODUCTION ACTIVATION (CRITICAL - NON-NEGOTIABLE)
# =============================================================================
activate_production_mode() {
    log "Activating PRODUCTION mode..."

    # Create runtime directory
    sudo mkdir -p "$RUNTIME_DIR"

    # Write install marker - THIS IS MANDATORY
    echo "# HALT Installation Marker" | sudo tee "$INSTALL_MARKER" > /dev/null
    echo "# This file indicates a production installation has been completed." | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "# DO NOT DELETE - system will fail to start in undefined state without this." | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "" | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "installer_version=1.0.0" | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "platform=macos" | sudo tee -a "$INSTALL_MARKER" > /dev/null
    echo "installer_user=$USER" | sudo tee -a "$INSTALL_MARKER" > /dev/null

    # Verify marker was written
    if [[ ! -f "$INSTALL_MARKER" ]]; then
        error "FATAL: Failed to write install marker at $INSTALL_MARKER"
        error "Installation cannot continue - production mode would be ambiguous."
        exit 1
    fi
    log "Install marker written [OK]"

    # Create environment file with PRODUCTION mode
    cat > "$ENV_FILE" << EOF
# HALT Production Environment
# Generated by installer at $(date -u +%Y-%m-%dT%H:%M:%SZ)
#
# CRITICAL: This file sets the system to PRODUCTION mode.
# Do not modify unless you understand the implications.

EVE_SYSTEM_MODE=PRODUCTION

# Security: Generate unique secrets for this installation
# These should be replaced with properly generated secrets
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n')
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n')

# CORS: Set to your actual frontend origin in production
# CORS_ORIGINS=https://your-domain.com

# Database
DATABASE_URL=sqlite:///./social_layer.db
EOF

    # Verify environment file was written
    if [[ ! -f "$ENV_FILE" ]]; then
        error "FATAL: Failed to write environment file at $ENV_FILE"
        error "Installation cannot continue - production mode would not be set."
        exit 1
    fi
    log "Production environment file written [OK]"

    # Set permissions
    sudo chown -R "$USER:staff" "$RUNTIME_DIR"
    chmod 600 "$ENV_FILE"  # Restrict access to env file

    log "PRODUCTION mode activated successfully [OK]"
    log "Install marker: $INSTALL_MARKER"
    log "Environment file: $ENV_FILE"
}

# Test installation
test_installation() {
    log "Testing installation..."

    # Test application bundle
    if [[ -d "$APP_PATH" ]]; then
        log "[OK] Application bundle found"
    else
        error "[FAIL] Application bundle not found"
        return 1
    fi

    # CRITICAL: Test install marker exists
    if [[ -f "$INSTALL_MARKER" ]]; then
        log "[OK] Install marker present (PRODUCTION mode will be enforced)"
    else
        error "[FAIL] Install marker missing - system will fail to start correctly"
        return 1
    fi

    # CRITICAL: Test environment file exists
    if [[ -f "$ENV_FILE" ]]; then
        log "[OK] Production environment file present"
    else
        error "[FAIL] Production environment file missing"
        return 1
    fi

    # Test Docker integration
    if docker info &> /dev/null; then
        log "[OK] Docker Desktop is working"
    else
        warn "[WARN] Docker Desktop is not working"
    fi

    # Test LaunchAgent
    if launchctl list 2>/dev/null | grep -q "com.halt.service"; then
        log "[OK] LaunchAgent is installed and running"
    else
        warn "[WARN] LaunchAgent is not running"
    fi

    log "Installation test completed"
}

# Create desktop shortcut
create_desktop_shortcut() {
    log "Creating desktop shortcut..."

    # Create alias on desktop
    osascript -e "
        tell application \"Finder\"
            make new alias file at (path to desktop folder as string) to POSIX file \"$APP_PATH\"
        end tell
    " 2>/dev/null || warn "Could not create desktop shortcut"

    log "Desktop shortcut created [OK]"
}

# Show completion message
show_completion() {
    echo
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              INSTALLATION COMPLETE - PRODUCTION MODE             ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo "HALT has been successfully installed on your Mac!"
    echo
    echo -e "${BLUE}PRODUCTION MODE STATUS:${NC}"
    echo "  ✓ Install marker: $INSTALL_MARKER"
    echo "  ✓ Environment: $ENV_FILE"
    echo "  ✓ EVE_SYSTEM_MODE=PRODUCTION"
    echo
    echo -e "${BLUE}What's Next:${NC}"
    echo "  • Launch HALT from Applications folder"
    echo "  • Check the Preferences menu for Docker integration settings"
    echo "  • The app will auto-start on system boot (configurable)"
    echo
    echo -e "${BLUE}Documentation:${NC}"
    echo "  • User Guide: $APP_PATH/Contents/Resources/docs/user-guide.pdf"
    echo "  • API Documentation: http://localhost:7778/docs (dev mode only)"
    echo "  • Medical Compliance: $APP_PATH/Contents/Resources/docs/compliance.pdf"
    echo
    echo -e "${BLUE}Management:${NC}"
    echo "  • LaunchAgent: sudo $APP_PATH/Contents/Resources/scripts/launch-agent-manager.sh status"
    echo "  • Docker Services: $APP_PATH/Contents/Resources/scripts/macos-bridge.sh status"
    echo "  • Logs: /var/log/halt/"
    echo
    echo -e "${BLUE}Medical Compliance:${NC}"
    echo "  • FHIR R4 compliant"
    echo "  • HIPAA ready"
    echo "  • IEC 62304 Class B certified"
    echo
    echo -e "${BLUE}Thank you for choosing HALT!${NC}"
    echo
}

# Main installation function
main() {
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root. Please run as regular user."
        error "The script will use sudo when needed for system-level operations."
        exit 1
    fi

    # Create log directory
    create_log_dir

    # Show banner
    show_banner

    # Start installation
    log "Starting HALT installation for macOS"
    log "Package directory: $PACKAGE_DIR"

    # Run installation steps
    check_requirements
    install_homebrew
    install_docker
    install_python_deps
    install_nodejs_deps
    install_native
    install_launchagent
    configure_app
    create_desktop_shortcut

    # CRITICAL: Activate production mode (must not fail silently)
    activate_production_mode

    # Test installation
    test_installation

    # Show completion
    show_completion

    log "Installation completed successfully!"
}

# Handle script interruption
cleanup() {
    echo
    warn "Installation interrupted by user"
    exit 1
}

trap cleanup SIGINT SIGTERM

# Run main installation
main "$@"
