#!/bin/bash
# =============================================================================
# HALT macOS Production Builder
# Master script that builds the complete macOS distribution package
# Combines: Electron Launcher (.app/.dmg) + Docker Stack + Native Components
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# CONFIGURATION
# =============================================================================

VERSION="${VERSION:-1.0.0}"
PRODUCT_NAME="HALT"
PUBLISHER="Hermetic Labs"
BUNDLE_ID="com.hermeticlabs.halt"

# Paths (relative to this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/../electron-launcher"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
OPS_DIR="$REPO_ROOT/ops"
DIST_DIR="$SCRIPT_DIR/dist"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    local type=$2
    case $type in
        "success") echo -e "${GREEN}✅ $1${NC}" ;;
        "error")   echo -e "${RED}❌ $1${NC}" ;;
        "warning") echo -e "${YELLOW}⚠️  $1${NC}" ;;
        "info")    echo -e "${CYAN}ℹ️  $1${NC}" ;;
        "step")    echo -e "${BLUE}▶️  $1${NC}" ;;
        *)         echo "$1" ;;
    esac
}

show_help() {
    echo -e "${CYAN}HALT macOS Production Builder${NC}"
    echo ""
    echo "Usage: $0 [ACTION]"
    echo ""
    echo "Actions:"
    echo "  all       - Build complete distribution (default)"
    echo "  electron  - Build Electron app only"
    echo "  docker    - Build Docker images only"
    echo "  sign      - Sign the application bundle"
    echo "  notarize  - Notarize with Apple (requires credentials)"
    echo "  clean     - Clean build artifacts"
    echo "  help      - Show this help"
    echo ""
    echo "Environment Variables:"
    echo "  VERSION              - App version (default: 1.0.0)"
    echo "  APPLE_ID             - Apple ID for notarization"
    echo "  APPLE_ID_PASSWORD    - App-specific password"
    echo "  APPLE_TEAM_ID        - Team ID"
    echo "  CSC_LINK             - Path to signing certificate"
    echo "  CSC_KEY_PASSWORD     - Certificate password"
    echo ""
    echo "Examples:"
    echo "  $0 all"
    echo "  $0 electron"
    echo "  VERSION=2.0.0 $0 all"
}

# =============================================================================
# PREREQUISITE CHECKS
# =============================================================================

check_prerequisites() {
    print_step "Checking prerequisites..." "step"
    
    local missing=()
    
    # Node.js
    if command -v node &> /dev/null; then
        local node_version=$(node --version)
        print_step "Node.js: $node_version" "success"
    else
        missing+=("Node.js (https://nodejs.org/)")
    fi
    
    # npm
    if command -v npm &> /dev/null; then
        local npm_version=$(npm --version)
        print_step "npm: $npm_version" "success"
    else
        missing+=("npm (comes with Node.js)")
    fi
    
    # Docker (optional)
    if command -v docker &> /dev/null; then
        local docker_version=$(docker --version)
        print_step "Docker: $docker_version" "success"
    else
        print_step "Docker not found (optional for Electron build)" "warning"
    fi
    
    # Xcode Command Line Tools
    if xcode-select -p &> /dev/null; then
        print_step "Xcode Command Line Tools: installed" "success"
    else
        print_step "Xcode Command Line Tools not found (required for signing)" "warning"
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        print_step "Missing required tools:" "error"
        for tool in "${missing[@]}"; do
            echo "  - $tool"
        done
        return 1
    fi
    
    return 0
}

# =============================================================================
# BUILD FUNCTIONS
# =============================================================================

build_electron() {
    print_banner "Building Electron App for macOS"
    
    if [ ! -d "$ELECTRON_DIR" ]; then
        print_step "Electron launcher not found at: $ELECTRON_DIR" "error"
        return 1
    fi
    
    pushd "$ELECTRON_DIR" > /dev/null
    
    # Install dependencies
    print_step "Installing Electron dependencies..." "step"
    npm install
    
    # Build for macOS
    print_step "Building macOS DMG..." "step"
    npm run build:mac
    
    # Check output
    local dist_path="$ELECTRON_DIR/dist"
    if ls "$dist_path"/*.dmg 1> /dev/null 2>&1; then
        local dmg_file=$(ls "$dist_path"/*.dmg | head -1)
        print_step "Electron build complete: $(basename "$dmg_file")" "success"
        
        # Copy to output
        mkdir -p "$DIST_DIR"
        cp "$dist_path"/*.dmg "$DIST_DIR/" 2>/dev/null || true
        cp -r "$dist_path"/*.app "$DIST_DIR/" 2>/dev/null || true
    else
        print_step "No DMG file found in dist" "error"
        popd > /dev/null
        return 1
    fi
    
    popd > /dev/null
    return 0
}

build_docker() {
    print_banner "Building Docker Stack"
    
    local compose_file="$OPS_DIR/docker-compose.yml"
    
    if [ ! -f "$compose_file" ]; then
        print_step "docker-compose.yml not found at: $compose_file" "error"
        return 1
    fi
    
    pushd "$OPS_DIR" > /dev/null
    
    print_step "Building Docker images..." "step"
    docker-compose -f docker-compose.yml build
    
    print_step "Docker images built successfully" "success"
    
    popd > /dev/null
    return 0
}

sign_app() {
    print_banner "Signing Application"
    
    local app_path="$DIST_DIR/HALT.app"
    
    if [ ! -d "$app_path" ]; then
        print_step "Application bundle not found: $app_path" "error"
        return 1
    fi
    
    if [ -z "$CSC_LINK" ]; then
        print_step "CSC_LINK not set - skipping signing" "warning"
        print_step "Set CSC_LINK to your .p12 certificate path for signing" "info"
        return 0
    fi
    
    print_step "Signing HALT.app..." "step"
    
    # Sign with codesign
    codesign --force --deep --sign "$CSC_LINK" "$app_path"
    
    # Verify
    if codesign --verify --verbose "$app_path"; then
        print_step "Application signed successfully" "success"
    else
        print_step "Signature verification failed" "error"
        return 1
    fi
    
    return 0
}

notarize_app() {
    print_banner "Notarizing with Apple"
    
    local dmg_path=$(ls "$DIST_DIR"/*.dmg 2>/dev/null | head -1)
    
    if [ -z "$dmg_path" ]; then
        print_step "No DMG found to notarize" "error"
        return 1
    fi
    
    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        print_step "Apple credentials not set - skipping notarization" "warning"
        print_step "Set APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID" "info"
        return 0
    fi
    
    print_step "Submitting for notarization..." "step"
    
    xcrun notarytool submit "$dmg_path" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_ID_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait
    
    if [ $? -eq 0 ]; then
        print_step "Notarization successful" "success"
        
        # Staple the ticket
        print_step "Stapling notarization ticket..." "step"
        xcrun stapler staple "$dmg_path"
        
        print_step "Notarization complete" "success"
    else
        print_step "Notarization failed" "error"
        return 1
    fi
    
    return 0
}

clean_build() {
    print_banner "Cleaning Build Artifacts"
    
    local clean_paths=(
        "$ELECTRON_DIR/dist"
        "$ELECTRON_DIR/node_modules"
        "$DIST_DIR"
    )
    
    for path in "${clean_paths[@]}"; do
        if [ -d "$path" ]; then
            print_step "Removing: $path" "step"
            rm -rf "$path"
        fi
    done
    
    print_step "Clean complete" "success"
    return 0
}

create_distribution_package() {
    print_banner "Creating Distribution Package"
    
    mkdir -p "$DIST_DIR"
    
    # Create package info
    cat > "$DIST_DIR/README.txt" << EOF
HALT - Medical AI Platform
Version: $VERSION
Publisher: $PUBLISHER
Build Date: $(date)

Contents:
- HALT.app - macOS application
- HALT-*.dmg - Disk image installer
- docker-compose.yml - Docker orchestration file

System Requirements:
- macOS 11 (Big Sur) or later
- 8 GB RAM minimum
- 4 GB free disk space
- Docker Desktop (for full deployment)

Quick Start:
1. Open HALT-*.dmg
2. Drag HALT.app to Applications
3. Launch from Applications
4. HALT will start Docker services automatically

For Docker-only deployment:
  docker-compose -f docker-compose.yml up -d

Support: https://docs.halt.com
EOF
    
    # Copy docker-compose for standalone users
    if [ -f "$OPS_DIR/docker-compose.yml" ]; then
        cp "$OPS_DIR/docker-compose.yml" "$DIST_DIR/"
    fi
    
    print_step "Distribution package created at: $DIST_DIR" "success"
    return 0
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║             HALT macOS Production Builder                   ║${NC}"
echo -e "${CYAN}║                   Hermetic Labs © 2025                        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

ACTION="${1:-all}"

case "$ACTION" in
    "all")
        print_step "Building complete macOS distribution..." "step"
        
        if ! check_prerequisites; then
            print_step "Prerequisites check failed" "error"
            exit 1
        fi
        
        success=true
        
        # Build Electron app
        if ! build_electron; then
            success=false
        fi
        
        # Build Docker stack (optional)
        if $success; then
            build_docker || print_step "Docker build failed, continuing..." "warning"
        fi
        
        # Create distribution package
        if $success; then
            create_distribution_package
        fi
        
        if $success; then
            echo ""
            print_step "BUILD COMPLETE!" "success"
            echo ""
            echo -e "${GREEN}Output: $DIST_DIR${NC}"
            echo ""
            
            # List outputs
            if [ -d "$DIST_DIR" ]; then
                echo "Generated files:"
                ls -la "$DIST_DIR"
            fi
        else
            print_step "BUILD FAILED" "error"
            exit 1
        fi
        ;;
    
    "electron")
        check_prerequisites && build_electron
        ;;
    
    "docker")
        check_prerequisites && build_docker
        ;;
    
    "sign")
        sign_app
        ;;
    
    "notarize")
        notarize_app
        ;;
    
    "clean")
        clean_build
        ;;
    
    "help"|"-h"|"--help")
        show_help
        ;;
    
    *)
        echo -e "${RED}Unknown action: $ACTION${NC}"
        show_help
        exit 1
        ;;
esac
