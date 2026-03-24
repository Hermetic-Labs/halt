#!/bin/bash
# HALT LaunchAgent Management Script
# Handles installation, removal, and status of the macOS LaunchAgent
set -euo pipefail
# Configuration
AGENT_PLIST="com.halt.plist"
AGENT_PLIST_PATH="/Applications/HALT.app/Contents/Resources/launch-agent/${AGENT_PLIST}"
AGENT_DEST_PATH="/Library/LaunchAgents/${AGENT_PLIST}"
LOG_DIR="/var/log/halt"
APP_PATH="/Applications/HALT.app"
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
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" >&2
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}
# Check
    if running as root

check_root() {
    if [[ $EUID -ne 0 ]];
    then
    error "This script must be run as root
    for LaunchAgent management"
    error "Please run:
    sudo $0 $@"
    exit 1
    fi
}
# Create
    log directory

create_log_dir() {
    if [[ ! -d "$LOG_DIR" ]];
    then
    mkdir -p "$LOG_DIR"
    chmod 755 "$LOG_DIR"
    log "Created
    log directory: $LOG_DIR"
    fi
}
# Install LaunchAgent

install_agent() {
    log "Installing HALT LaunchAgent..."
# Check
    if the plist
    file exists
    if [[ ! -f "$AGENT_PLIST_PATH" ]];
    then
    error "LaunchAgent plist not found at: $AGENT_PLIST_PATH"
    exit 1
    fi
# Create LaunchAgents directory
    if it
    doesn't exist
    mkdir -p "/Library/LaunchAgents"
# Copy plist
    file
    cp "$AGENT_PLIST_PATH" "$AGENT_DEST_PATH"
    chmod 644 "$AGENT_DEST_PATH"
# Set correct ownership
    chown root:wheel "$AGENT_DEST_PATH"
    log "LaunchAgent plist copied to: $AGENT_DEST_PATH"
# Load the agent
    load_agent
    log "HALT LaunchAgent installed successfully"
}
# Unload LaunchAgent

unload_agent() {
    log "Unloading HALT LaunchAgent..."
    if
    launchctl list |
    grep -q "com.halt.service";
    then
    launchctl unload "$AGENT_DEST_PATH" 2>/dev/null || true
    log "LaunchAgent unloaded"
    else
    log "LaunchAgent was not loaded"
    fi
}
# Load LaunchAgent

load_agent() {
    log "Loading HALT LaunchAgent..."
# Unload
    if already loaded
    if
    launchctl list |
    grep -q "com.halt.service";
    then
    warn "LaunchAgent already loaded, reloading..."
    launchctl unload "$AGENT_DEST_PATH" 2>/dev/null || true
    fi
# Load the agent
    launchctl load "$AGENT_DEST_PATH"
    if [[ $? -eq 0 ]];
    then
    log "LaunchAgent loaded successfully"
# Verify it's running
    sleep 2
    if
    launchctl list |
    grep -q "com.halt.service";
    then
    log "LaunchAgent is running"
    else
    warn "LaunchAgent may not be running properly"
    fi
    else
    error "Failed to load LaunchAgent"
    exit 1
    fi
}
# Remove LaunchAgent

remove_agent() {
    log "Removing HALT LaunchAgent..."
# Unload
    first
    unload_agent
# Remove the plist
    file
    if [[ -f "$AGENT_DEST_PATH" ]];
    then
    rm -f "$AGENT_DEST_PATH"
    log "LaunchAgent plist removed"
    else
    log "LaunchAgent plist was not found"
    fi
    log "HALT LaunchAgent removed"
}
# Check LaunchAgent status

status_agent() {
    log "Checking HALT LaunchAgent status..."
# Check
    if plist
    file exists
    if [[ -f "$AGENT_DEST_PATH" ]];
    then
    echo -e "${GREEN}[OK]${NC} LaunchAgent plist exists: $AGENT_DEST_PATH"
    else
    echo -e "${RED}[FAIL]${NC} LaunchAgent plist not found: $AGENT_DEST_PATH"
    return 1
    fi
# Check
    if agent is loaded
    if
    launchctl list |
    grep -q "com.halt.service";
    then
    echo -e "${GREEN}[OK]${NC} LaunchAgent is loaded"
# Get more details
    local pid=$(launchctl list |
    grep "com.halt.service" |
    awk '{print $1}')
    if [[ "$pid" != "-" ]];
    then
    echo -e "${BLUE}Info:${NC} PID: $pid"
    fi
# Check last
    exit status
    local exit_status=$(launchctl list |
    grep "com.halt.service" |
    awk '{print $2}')
    echo -e "${BLUE}Info:${NC} Last
    exit status: $exit_status"
# Check recent logs
    if [[ -f "$LOG_DIR/launch-agent.log" ]];
    then
    echo -e "${BLUE}Info:${NC} Recent logs:"
    tail -n 5 "$LOG_DIR/launch-agent.log" |
    while
    read -r line;
    do
    echo " $line"
   
    done
    fi
    else
    echo -e "${YELLOW}!${NC} LaunchAgent is not loaded"
    fi
# Check app installation
    if [[ -d "$APP_PATH" ]];
    then
    echo -e "${GREEN}[OK]${NC} HALT app found: $APP_PATH"
    else
    echo -e "${RED}[FAIL]${NC} HALT app not found: $APP_PATH"
    fi
}
# Restart LaunchAgent

restart_agent() {
    log "Restarting HALT LaunchAgent..."
    unload_agent
    load_agent
    log "LaunchAgent restarted"
}
# Enable auto-start

enable_auto_start() {
    log "Enabling HALT auto-start..."
    if [[ ! -f "$AGENT_DEST_PATH" ]];
    then
    error "LaunchAgent not installed. Run install
    first."
    exit 1
    fi
# Set RunAtLoad to true in plist
    /usr/libexec/PlistBuddy -c "Add :RunAtLoad bool true" "$AGENT_DEST_PATH" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :RunAtLoad bool true" "$AGENT_DEST_PATH"
    log "Auto-start enabled"
}
# Disable auto-start

disable_auto_start() {
    log "Disabling HALT auto-start..."
    if [[ ! -f "$AGENT_DEST_PATH" ]];
    then
    error "LaunchAgent not installed. Run install
    first."
    exit 1
    fi
# Set RunAtLoad to false in plist
    /usr/libexec/PlistBuddy -c "Set :RunAtLoad bool false" "$AGENT_DEST_PATH"
    log "Auto-start disabled"
}
# Show help

show_help() {
    echo "HALT LaunchAgent Management Script"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo " install Install and enable the LaunchAgent"
    echo " uninstall Remove the LaunchAgent"
    echo " start Start the LaunchAgent"
    echo " stop Stop the LaunchAgent"
    echo " restart Restart the LaunchAgent"
    echo " status Show LaunchAgent status"
    echo " enable Enable auto-start on system boot"
    echo " disable Disable auto-start on system boot"
    echo " help Show this help message"
    echo ""
    echo "Examples:"
    echo "
    sudo $0 install"
    echo "
    sudo $0 status"
    echo "
    sudo $0 restart"
}
# Main script logic

main() {
# Ensure we have a command
    if [[ $# -eq 0 ]];
    then
    show_help
    exit 1
    fi
# Create
    log directory
    create_log_dir
# Parse command
    case "$1" in install)
    check_root
    install_agent ;; uninstall|remove)
    check_root
    remove_agent ;; start|load)
    check_root
    load_agent ;; stop|unload)
    check_root
    unload_agent ;; restart)
    check_root
    restart_agent ;; status) status_agent ;; enable)
    check_root
    enable_auto_start ;; disable)
    check_root
    disable_auto_start ;; help|--help|-h)
    show_help ;; *)
    error "Unknown command: $1"
    show_help
    exit 1 ;;
    esac
}
# Run
    main function
    main "$@"
