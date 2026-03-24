#!/bin/bash
# HALT macOS Docker Bridge
# Handles communication between native app and Docker Desktop services
set -euo pipefail
# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="/Applications/HALT.app"
RESOURCES_PATH="$APP_PATH/Contents/Resources"
DOCKER_COMPOSE_FILE="$RESOURCES_PATH/docker-desktop/docker-compose.mac.yml"
LOG_FILE="/var/log/halt/bridge.log"
PID_FILE="$RESOURCES_PATH/halt-bridge.pid"
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
# Create
    log directory

create_log_dir() {
    if [[ ! -d "/var/log/halt" ]];
    then
    mkdir -p "/var/log/halt"
    chmod 755 "/var/log/halt"
    fi
}
# Check Docker Desktop availability

check_docker() {
    log "Checking Docker Desktop availability..."
    if ! command -v
   
    docker &> /dev/null;
    then
    error "Docker command not found"
    return 1
    fi
    if !
   
    docker info &> /dev/null;
    then
    error "Docker daemon is not running"
    return 1
    fi
    log "Docker Desktop is available"
    return 0
}
# Get HALT container status

get_container_status() {
    local status_file="$RESOURCES_PATH/container-status.json"
# Check
    for HALT containers
    local backend_status=$(docker ps --filter "name=halt-backend" --format "{{.Status}}" 2>/dev/null ||
    echo "not_running")
    local app_status=$(docker ps --filter "name=halt-app" --format "{{.Status}}" 2>/dev/null ||
    echo "not_running")
    local db_status=$(docker ps --filter "name=eve-db" --format "{{.Status}}" 2>/dev/null ||
    echo "not_running")
# Create status JSON
    cat > "$status_file" <<
EOF { "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "backend": "$backend_status", "app": "$app_status", "database": "$db_status", "all_running": $([ "$backend_status" != "not_running" ] && [ "$app_status" != "not_running" ] &&
    echo "true" ||
    echo "false")
}
EOF
    log "Container status saved to $status_file"
    cat "$status_file"
}
# Start HALT services

start_services() {
    log "Starting HALT Docker services..."
    if [[ ! -f "$DOCKER_COMPOSE_FILE" ]];
    then
    error "Docker Compose
    file not found: $DOCKER_COMPOSE_FILE"
    return 1
    fi
# Check
    if services are already running
    if
   
    docker ps --filter "name=halt" --format "{{.Names}}" |
    grep -q .;
    then
    warn "Some HALT containers are already running"
    return 0
    fi
# Start services
    if
   
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d;
    then
    log "HALT services started successfully"
# Wait
    for services to be healthy
    sleep 10
# Check health
    if
    get_container_status |
    grep -q '"all_running":true';
    then
    log "All services are running"
    return 0
    else
    warn "Some services may not be fully started yet"
    return 1
    fi
    else
    error "Failed to start HALT services"
    return 1
    fi
}
# Stop HALT services

stop_services() {
    log "Stopping HALT Docker services..."
    if
   
    docker-compose -f "$DOCKER_COMPOSE_FILE"
    down;
    then
    log "HALT services stopped successfully"
    return 0
    else
    error "Failed to stop HALT services"
    return 1
    fi
}
# Restart HALT services

restart_services() {
    log "Restarting HALT Docker services..."
    stop_services
    sleep 5
    start_services
}
# Get service logs

get_logs() {
    local service=${1:-""}
    local lines=${2:-100}
    if [[ -n "$service" ]];
    then
   
    docker logs --tail "$lines" "halt-$service" 2>&1 |
    tail -50
    else
    echo "=== Backend Logs ==="
   
    docker logs --tail "$lines" halt-backend-mac 2>&1 |
    tail -20
    echo -e "\n=== App Logs ==="
   
    docker logs --tail "$lines" halt-app-mac 2>&1 |
    tail -20
    echo -e "\n=== Database Logs ==="
   
    docker logs --tail "$lines" eve-db-mac 2>&1 |
    tail -20
    fi
}
# Check service health

check_health() {
    log "Checking service health..."
# Check backend health
    if
    curl -s http://localhost:7778/health >/dev/null 2>&1;
    then
    log "[OK] Backend is healthy"
    else
    warn "[FAIL] Backend health check failed"
    fi
# Check frontend
    if
    curl -s http://localhost:80 >/dev/null 2>&1;
    then
    log "[OK] Frontend is healthy"
    else
    warn "[FAIL] Frontend health check failed"
    fi
# Check database
    if
   
    docker exec eve-db-mac pg_isready -U eveadmin >/dev/null 2>&1;
    then
    log "[OK] Database is healthy"
    else
    warn "[FAIL] Database health check failed"
    fi
}
# Update services

update_services() {
    log "Updating HALT services..."
# Pull latest images
    if
   
    docker-compose -f "$DOCKER_COMPOSE_FILE" pull;
    then
    log "Docker images updated"
# Restart services with new images
   
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    log "Services updated and restarted"
    else
    error "Failed to update Docker images"
    return 1
    fi
}
# Monitor services

monitor_services() {
    log "Starting service monitor..."
    while true;
    do
# Check
    if services are running
    if !
   
    docker ps --filter "name=halt" --format "{{.Names}}" |
    grep -q .;
    then
    warn "No HALT containers running, attempting to start..."
    start_services
    fi
# Health check
    check_health
# Wait before next check
    sleep 30
   
    done
}
# Handle signals

handle_signal() {
    log "Received signal, shutting
    down..."
    cleanup
    exit 0
}
# Cleanup

cleanup() {
    log "Cleaning up..."
    if [[ -f "$PID_FILE" ]];
    then
    rm -f "$PID_FILE"
    fi
}
# Main bridge function

main() {
    create_log_dir
# Save PID
    echo $$ > "$PID_FILE"
# Set up signal handlers trap
    handle_signal SIGTERM SIGINT
    log "HALT Docker Bridge started"
# Check Docker availability
    if !
    check_docker;
    then
    error "Docker Desktop is required but not available"
    exit 1
    fi
# Parse command
    case "${1:-monitor}" in start)
    start_services ;; stop)
    stop_services ;; restart)
    restart_services ;; status)
    get_container_status ;; health)
    check_health ;; logs)
    get_logs "${2:-}" "${3:-100}" ;; update)
    update_services ;; monitor)
    monitor_services ;; *)
    echo "HALT Docker Bridge"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo " start Start HALT services"
    echo " stop Stop HALT services"
    echo " restart Restart HALT services"
    echo " status Get container status"
    echo " health Check service health"
    echo " logs [service] [lines] Get service logs"
    echo " update Update and restart services"
    echo " monitor Monitor services (default)"
    echo ""
    echo "Examples:"
    echo " $0 start"
    echo " $0 logs backend 50"
    echo " $0 health"
    exit 1 ;;
    esac
    cleanup
}
# Run
    main function
    main "$@"
