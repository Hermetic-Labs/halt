#!/bin/bash
# HALT Mac Package Validation Script
# Validates the package structure and configuration
set -euo pipefail
# Configuration
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$PACKAGE_DIR")")"
VALIDATION_LOG="$PACKAGE_DIR/validation-report.log"
# Colors
    for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
# No Color
# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0
# Validation functions

log_pass() {
    echo -e "${GREEN}[OK] PASS${NC}: $1" |
    tee -a "$VALIDATION_LOG" ((PASSED_CHECKS++)) ((TOTAL_CHECKS++))
}

log_fail() {
    echo -e "${RED}[FAIL] FAIL${NC}: $1" |
    tee -a "$VALIDATION_LOG" ((FAILED_CHECKS++)) ((TOTAL_CHECKS++))
}

log_warn() {
    echo -e "${YELLOW}[EMOJI] WARN${NC}: $1" |
    tee -a "$VALIDATION_LOG" ((WARNING_CHECKS++)) ((TOTAL_CHECKS++))
}

log_info() {
    echo -e "${BLUE}Info: INFO${NC}: $1" |
    tee -a "$VALIDATION_LOG"
}
# Check
    file existence

check_file() { local
    file="$1"
    local description="$2"
    if [[ -f "$file" ]];
    then
    log_pass "$description exists: $file"
    return 0
    else
    log_fail "$description missing: $file"
    return 1
    fi
}
# Check directory existence

check_dir() {
    local dir="$1"
    local description="$2"
    if [[ -d "$dir" ]];
    then
    log_pass "$description exists: $dir"
    return 0
    else
    log_fail "$description missing: $dir"
    return 1
    fi
}
# Check
    file permissions

check_permissions() { local
    file="$1"
    local expected="$2"
    local description="$3"
    if [[ -x "$file" ]];
    then
    log_pass "$description has execute permissions"
    return 0
    else
    log_warn "$description missing execute permissions"
    return 1
    fi
}
# Validate Info.plist

validate_plist() {
    local plist="$1"
    if [[ ! -f "$plist" ]];
    then
    log_fail "Info.plist not found: $plist"
    return 1
    fi
# Check required keys
    local required_keys=( "CFBundleName" "CFBundleIdentifier" "CFBundleVersion" "CFBundleExecutable" )
    for key in "${required_keys[@]}";
    do
    if
    grep -q "<key>$key</key>" "$plist";
    then
    log_pass "Info.plist contains required key: $key"
    else
    log_fail "Info.plist missing required key: $key"
    fi
   
    done
}
# Validate Docker Compose configuration

validate_docker_compose() {
    local compose_file="$1"
    if [[ ! -f "$compose_file" ]];
    then
    log_fail "Docker Compose
    file not found: $compose_file"
    return 1
    fi
# Check
    if it's valid YAML
    if
    python3 -c "import yaml; yaml.safe_load(open('$compose_file'))" 2>/dev/null;
    then
    log_pass "Docker Compose
    file is valid YAML"
    else
    log_fail "Docker Compose
    file is not valid YAML"
    return 1
    fi
# Check
    for required services
    local required_services=( "halt-backend" "halt-app" "eve-db" )
    for service in "${required_services[@]}";
    do
    if
    grep -q "$service:" "$compose_file";
    then
    log_pass "Docker Compose contains required service: $service"
    else
    log_warn "Docker Compose missing service: $service"
    fi
   
    done
}
# Validate LaunchAgent plist

validate_launchagent() {
    local plist="$1"
    if [[ ! -f "$plist" ]];
    then
    log_fail "LaunchAgent plist not found: $plist"
    return 1
    fi
# Check
    if plist is valid
    if
    /usr/libexec/PlistBuddy -c "Print" "$plist" >/dev/null 2>&1;
    then
    log_pass "LaunchAgent plist is valid"
    else
    log_fail "LaunchAgent plist is invalid"
    return 1
    fi
# Check required keys
    local required_keys=( "Label" "ProgramArguments" "RunAtLoad" )
    for key in "${required_keys[@]}";
    do
    if
    /usr/libexec/PlistBuddy -c "Print :$key" "$plist" >/dev/null 2>&1;
    then
    log_pass "LaunchAgent plist contains required key: $key"
    else
    log_fail "LaunchAgent plist missing required key: $key"
    fi
   
    done
}
# Validate Python script

validate_python() {
    local script="$1"
    if [[ ! -f "$script" ]];
    then
    log_fail "Python script not found: $script"
    return 1
    fi
# Check
    if Python script is syntactically valid
    if
    python3 -m py_compile "$script" 2>/dev/null;
    then
    log_pass "Python script is syntactically valid"
    else
    log_fail "Python script has syntax errors"
    return 1
    fi
# Check
    for shebang
    if
    head -n 1 "$script" |
    grep -q "^#!/";
    then
    log_pass "Python script has shebang"
    else
    log_warn "Python script missing shebang"
    fi
}
# Validate bash script

validate_bash() {
    local script="$1"
    if [[ ! -f "$script" ]];
    then
    log_fail "Bash script not found: $script"
    return 1
    fi
# Check syntax
    if bash -n "$script" 2>/dev/null;
    then
    log_pass "Bash script syntax is valid"
    else
    log_fail "Bash script has syntax errors"
    return 1
    fi
# Check
    for shebang
    if
    head -n 1 "$script" |
    grep -q "^#!/bin/bash";
    then
    log_pass "Bash script has correct shebang"
    else
    log_warn "Bash script missing or incorrect shebang"
    fi
# Check execute permissions
    check_permissions "$script" "x" "Bash script"
}
# Validate package structure

validate_package_structure() {
    log_info "Validating package structure..."
# Check
    main directories
    check_dir "$PACKAGE_DIR" "Package directory"
    check_dir "$PACKAGE_DIR/app-bundle" "App bundle directory"
    check_dir "$PACKAGE_DIR/docker-desktop" "Docker Desktop directory"
    check_dir "$PACKAGE_DIR/launch-agent" "LaunchAgent directory"
    check_dir "$PACKAGE_DIR/native-executable" "Native executable directory"
    check_dir "$PACKAGE_DIR/scripts" "Scripts directory"
    check_dir "$PACKAGE_DIR/docs" "Docs directory"
}
# Validate app bundle

validate_app_bundle() {
    log_info "Validating app bundle..."
    check_file "$PACKAGE_DIR/app-bundle/Info.plist" "App bundle Info.plist"
    check_file "$PACKAGE_DIR/app-bundle/main.js" "Electron
    main script"
    check_file "$PACKAGE_DIR/app-bundle/preferences.html" "Preferences HTML"
    if [[ -f "$PACKAGE_DIR/app-bundle/Info.plist" ]];
    then
    validate_plist "$PACKAGE_DIR/app-bundle/Info.plist"
    fi
}
# Validate Docker configuration

validate_docker_config() {
    log_info "Validating Docker Desktop configuration..."
    check_file "$PACKAGE_DIR/docker-desktop/docker-compose.mac.yml" "Docker Compose
    file"
    check_file "$PACKAGE_DIR/docker-desktop/Dockerfile.mac" "Dockerfile
    for Mac"
    check_file "$PACKAGE_DIR/docker-desktop/nginx.mac.conf" "Nginx configuration"
    check_file "$PACKAGE_DIR/docker-desktop/default.mac.conf" "Default server config"
    check_file "$PACKAGE_DIR/docker-desktop/security-headers.mac.conf" "Security headers"
    if [[ -f "$PACKAGE_DIR/docker-desktop/docker-compose.mac.yml" ]];
    then
    validate_docker_compose "$PACKAGE_DIR/docker-desktop/docker-compose.mac.yml"
    fi
}
# Validate LaunchAgent

validate_launchagent_config() {
    log_info "Validating LaunchAgent configuration..."
    check_file "$PACKAGE_DIR/launch-agent/com.halt.plist" "LaunchAgent plist"
    if [[ -f "$PACKAGE_DIR/launch-agent/com.halt.plist" ]];
    then
    validate_launchagent "$PACKAGE_DIR/launch-agent/com.halt.plist"
    fi
}
# Validate native executable

validate_native_executable() {
    log_info "Validating native executable..."
    check_file "$PACKAGE_DIR/native-executable/halt-native.py" "Native Python app"
    check_file "$PACKAGE_DIR/native-executable/halt.spec" "PyInstaller spec"
    check_file "$PACKAGE_DIR/native-executable/version_info.txt" "Version info"
    if [[ -f "$PACKAGE_DIR/native-executable/halt-native.py" ]];
    then
    validate_python "$PACKAGE_DIR/native-executable/halt-native.py"
    fi
}
# Validate scripts

validate_scripts() {
    log_info "Validating scripts..."
    local scripts=( "$PACKAGE_DIR/scripts/install.sh" "$PACKAGE_DIR/scripts/install-native.sh" "$PACKAGE_DIR/scripts/build-native.sh" "$PACKAGE_DIR/scripts/launch-agent-manager.sh" "$PACKAGE_DIR/scripts/macos-bridge.sh" )
    for script in "${scripts[@]}";
    do
    if [[ -f "$script" ]];
    then
    validate_bash "$script"
    else
    log_fail "Script not found: $script"
    fi
   
    done
}
# Validate
    documentation

validate_documentation() {
    log_info "Validating
    documentation..."
    check_file "$PACKAGE_DIR/README.md" "README
    file"
    check_file "$PACKAGE_DIR/docs/macos-installation-guide.md" "Installation guide"
}
# Check system requirements

check_system_requirements() {
    log_info "Checking system requirements..."
# Check macOS version
    local macos_version=$(sw_vers -productVersion 2>/dev/null ||
    echo "unknown")
    log_info "macOS version: $macos_version"
# Check architecture
    local arch=$(uname -m 2>/dev/null ||
    echo "unknown")
    log_info "Architecture: $arch"
# Check available commands
    local commands=("python3" "node" "docker" "launchctl")
    for cmd in "${commands[@]}";
    do
    if command -v "$cmd" >/dev/null 2>&1;
    then
    log_pass "Command available: $cmd"
    else
    log_warn "Command not available: $cmd"
    fi
   
    done
}
# Generate package summary

generate_summary() {
    log_info "Generating package summary..."
    local summary_file="$PACKAGE_DIR/package-summary.json"
    cat > "$summary_file" <<
EOF { "package_name": "HALT", "version": "1.0.0", "platform": "macos", "architecture": ["x86_64", "arm64"], "min_macos_version": "10.15", "validation_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "validation_results": { "total_checks": $TOTAL_CHECKS, "passed": $PASSED_CHECKS, "failed": $FAILED_CHECKS, "warnings": $WARNING_CHECKS
}, "components": { "app_bundle": $([ -d "$PACKAGE_DIR/app-bundle" ] &&
    echo "true" ||
    echo "false"), "docker_desktop": $([ -d "$PACKAGE_DIR/docker-desktop" ] &&
    echo "true" ||
    echo "false"), "launch_agent": $([ -f "$PACKAGE_DIR/launch-agent/com.halt.plist" ] &&
    echo "true" ||
    echo "false"), "native_executable": $([ -f "$PACKAGE_DIR/native-executable/halt-native.py" ] &&
    echo "true" ||
    echo "false"), "installation_scripts": $([ -d "$PACKAGE_DIR/scripts" ] &&
    echo "true" ||
    echo "false"), "documentation": $([ -d "$PACKAGE_DIR/docs" ] &&
    echo "true" ||
    echo "false")
}, "features": [ "FHIR R4 compliant", "HIPAA ready", "IEC 62304 Class B", "Docker Desktop integration", "Native macOS app bundle", "LaunchAgent support", "Health monitoring", "Security hardened" ]
}
EOF
    log_pass "Package summary generated: $summary_file"
}
# Main validation function

main() {
    echo -e "${BLUE}${NC}"
    echo -e "${BLUE} HALT Mac Package Validation ${NC}"
    echo -e "${BLUE}${NC}" echo
# Initialize validation log
    echo "HALT Mac Package Validation Report" > "$VALIDATION_LOG"
    echo "Generated: $(date)" >> "$VALIDATION_LOG"
    echo "Package Directory: $PACKAGE_DIR" >> "$VALIDATION_LOG"
    echo "========================================" >> "$VALIDATION_LOG"
    echo >> "$VALIDATION_LOG"
# Run validation checks
    validate_package_structure
    validate_app_bundle
    validate_docker_config
    validate_launchagent_config
    validate_native_executable
    validate_scripts
    validate_documentation
    check_system_requirements
# Generate summary
    generate_summary
# Show results
    echo echo -e "${BLUE}${NC}"
    echo -e "${BLUE} Validation Results ${NC}"
    echo -e "${BLUE}${NC}"
    echo echo -e "Total Checks: $TOTAL_CHECKS"
    echo -e "${GREEN}Passed: $PASSED_CHECKS${NC}"
    echo -e "${RED}Failed: $FAILED_CHECKS${NC}"
    echo -e "${YELLOW}Warnings: $WARNING_CHECKS${NC}" echo
    if [[ $FAILED_CHECKS -eq 0 ]];
    then
    echo -e "${GREEN}[EMOJI] Package validation PASSED!${NC}"
    echo -e "${GREEN}The HALT Mac package is ready
    for distribution.${NC}"
    else
    echo -e "${RED}[EMOJI] Package validation FAILED!${NC}"
    echo -e "${RED}Please
    fix the issues above before distribution.${NC}"
    fi
    echo
    log_info "Validation
    log saved to: $VALIDATION_LOG"
# Return appropriate
    exit code
    if [[ $FAILED_CHECKS -eq 0 ]];
    then
    exit 0
    else
    exit 1
    fi
}
# Handle script interruption

cleanup() {
    echo
    warn "Validation interrupted by user"
    exit 1
} trap
    cleanup SIGINT SIGTERM
# Run validation
    main "$@"
