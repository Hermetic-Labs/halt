#!/usr/bin/env bash
#===============================================================================
# PI5 KIOSK FORGE - Production Image Builder
# A robust bridge to package your app onto Raspberry Pi 5 SD cards
#===============================================================================
set -euo pipefail
IFS=$'\n\t'

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly VERSION="1.0.0"
readonly LOG_FILE="${SCRIPT_DIR}/build/forge-$(date +%Y%m%d-%H%M%S).log"
readonly WORK_DIR="${SCRIPT_DIR}/build/work"
readonly OUTPUT_DIR="${SCRIPT_DIR}/build/output"
readonly RPI_IMAGE_GEN_DIR="${SCRIPT_DIR}/build/rpi-image-gen"

# Retry configuration
readonly MAX_RETRIES=3
readonly RETRY_DELAY=5

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color
readonly BOLD='\033[1m'

# ══════════════════════════════════════════════════════════════════════════════
# LOGGING & OUTPUT
# ══════════════════════════════════════════════════════════════════════════════
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Log to file
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
    
    # Log to console with colors
    case "$level" in
        INFO)   echo -e "${BLUE}ℹ${NC}  $message" ;;
        OK)     echo -e "${GREEN}✓${NC}  $message" ;;
        WARN)   echo -e "${YELLOW}⚠${NC}  $message" ;;
        ERROR)  echo -e "${RED}✗${NC}  $message" >&2 ;;
        STEP)   echo -e "${CYAN}${BOLD}▸${NC} ${BOLD}$message${NC}" ;;
        DEBUG)  [[ "${DEBUG:-0}" == "1" ]] && echo -e "   $message" ;;
    esac
}

banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════════════════════╗
    ║   ____  _ ____    _  ___           _      _____           ║
    ║  |  _ \(_) ___|  | |/ (_) ___  ___| | __ |  ___|__  _ __  ║
    ║  | |_) | \___ \  | ' /| |/ _ \/ __| |/ / | |_ / _ \| '__| ║
    ║  |  __/| |___) | | . \| | (_) \__ \   <  |  _| (_) | | __ ║
    ║  |_|   |_|____/  |_|\_\_|\___/|___/_|\_\ |_|  \___/|_|(_) ║
    ║                                                           ║
    ║           Raspberry Pi 5 Image Builder v1.0.0             ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# ══════════════════════════════════════════════════════════════════════════════
# ERROR HANDLING & RECOVERY
# ══════════════════════════════════════════════════════════════════════════════
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log ERROR "Build failed with exit code $exit_code"
        log INFO "Check log file: $LOG_FILE"
    fi
    # Cleanup any mounted filesystems
    if [[ -d "${WORK_DIR}/mnt" ]]; then
        sudo umount -R "${WORK_DIR}/mnt" 2>/dev/null || true
    fi
    # Remove any loop devices we created
    if [[ -n "${LOOP_DEVICE:-}" ]]; then
        sudo losetup -d "$LOOP_DEVICE" 2>/dev/null || true
    fi
}
trap cleanup EXIT

die() {
    log ERROR "$1"
    exit "${2:-1}"
}

# Retry wrapper with exponential backoff
retry() {
    local max_attempts="$1"
    local delay="$2"
    local description="$3"
    shift 3
    local cmd=("$@")
    
    local attempt=1
    while true; do
        log DEBUG "Attempt $attempt/$max_attempts: ${cmd[*]}"
        if "${cmd[@]}"; then
            return 0
        fi
        
        if (( attempt >= max_attempts )); then
            log ERROR "Failed after $max_attempts attempts: $description"
            return 1
        fi
        
        log WARN "Attempt $attempt failed, retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))  # Exponential backoff
        ((attempt++))
    done
}

# ══════════════════════════════════════════════════════════════════════════════
# DEPENDENCY CHECKS
# ══════════════════════════════════════════════════════════════════════════════
check_dependencies() {
    log STEP "Checking dependencies..."
    
    local missing=()
    local deps=(git sudo losetup parted mkfs.ext4 mkfs.vfat rsync curl wget)
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &>/dev/null; then
            missing+=("$dep")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log WARN "Missing dependencies: ${missing[*]}"
        log INFO "Attempting to install..."
        
        if command -v apt-get &>/dev/null; then
            retry $MAX_RETRIES $RETRY_DELAY "install dependencies" \
                sudo apt-get update -qq
            retry $MAX_RETRIES $RETRY_DELAY "install dependencies" \
                sudo apt-get install -y -qq "${missing[@]}"
        else
            die "Cannot auto-install dependencies. Please install: ${missing[*]}"
        fi
    fi
    
    log OK "All dependencies satisfied"
}

check_privileges() {
    log STEP "Checking privileges..."
    
    if [[ $EUID -eq 0 ]]; then
        log WARN "Running as root - this works but regular user is recommended"
    else
        if ! sudo -n true 2>/dev/null; then
            log INFO "Sudo access required for image operations"
            sudo -v || die "Sudo access required"
        fi
    fi
    
    log OK "Privileges OK"
}

check_disk_space() {
    log STEP "Checking disk space..."
    
    local required_gb=10
    local available_gb
    available_gb=$(df -BG "${SCRIPT_DIR}" | awk 'NR==2 {print $4}' | tr -d 'G')
    
    if (( available_gb < required_gb )); then
        die "Insufficient disk space. Need ${required_gb}GB, have ${available_gb}GB"
    fi
    
    log OK "Disk space OK (${available_gb}GB available)"
}

# ══════════════════════════════════════════════════════════════════════════════
# RPI-IMAGE-GEN SETUP
# ══════════════════════════════════════════════════════════════════════════════
setup_rpi_image_gen() {
    log STEP "Setting up rpi-image-gen..."
    
    if [[ -d "$RPI_IMAGE_GEN_DIR/.git" ]]; then
        log INFO "Updating existing rpi-image-gen..."
        (cd "$RPI_IMAGE_GEN_DIR" && git pull --quiet) || log WARN "Could not update, using existing"
    else
        log INFO "Cloning rpi-image-gen..."
        mkdir -p "$(dirname "$RPI_IMAGE_GEN_DIR")"
        retry $MAX_RETRIES $RETRY_DELAY "clone rpi-image-gen" \
            git clone --depth 1 https://github.com/raspberrypi/rpi-image-gen.git "$RPI_IMAGE_GEN_DIR"
    fi
    
    # Install dependencies if install script exists
    if [[ -x "$RPI_IMAGE_GEN_DIR/install_deps.sh" ]]; then
        log INFO "Installing rpi-image-gen dependencies..."
        (cd "$RPI_IMAGE_GEN_DIR" && sudo ./install_deps.sh) || log WARN "Some deps may be missing"
    fi
    
    log OK "rpi-image-gen ready"
}

# ══════════════════════════════════════════════════════════════════════════════
# APP INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════
validate_app_source() {
    local app_dir="$1"
    
    log STEP "Validating application source..."
    
    if [[ ! -d "$app_dir" ]]; then
        die "Application directory not found: $app_dir"
    fi
    
    # Check for common build artifacts
    local found_app=0
    
    # Check for Vite/React build output
    if [[ -d "$app_dir/dist" ]]; then
        log OK "Found Vite/React build: dist/"
        found_app=1
    elif [[ -d "$app_dir/build" ]]; then
        log OK "Found React build: build/"
        found_app=1
    fi
    
    # Check for Python backend
    if [[ -f "$app_dir/requirements.txt" ]] || [[ -f "$app_dir/pyproject.toml" ]]; then
        log OK "Found Python application"
        found_app=1
    fi
    
    # Check for package.json (source that needs building)
    if [[ -f "$app_dir/package.json" ]] && [[ ! -d "$app_dir/dist" ]] && [[ ! -d "$app_dir/build" ]]; then
        log WARN "Found package.json but no build output. Running npm build..."
        (cd "$app_dir" && npm install && npm run build) || die "Failed to build application"
        found_app=1
    fi
    
    if [[ $found_app -eq 0 ]]; then
        die "Could not identify application structure in: $app_dir"
    fi
    
    log OK "Application validated"
}

# ══════════════════════════════════════════════════════════════════════════════
# CUSTOM LAYER CREATION
# ══════════════════════════════════════════════════════════════════════════════
create_custom_layer() {
    local app_dir="$1"
    local layer_dir="${SCRIPT_DIR}/custom-layers"
    
    log STEP "Creating custom layer for your application..."
    
    mkdir -p "$layer_dir"
    
    # Create the main kiosk layer YAML
    cat > "$layer_dir/kiosk-app.yaml" << 'YAML'
# Custom Kiosk Application Layer
# Generated by Pi5 Kiosk Forge

layer:
  name: kiosk-app
  description: Custom kiosk application deployment
  
  packages:
    - chromium-browser
    - cage              # Minimal Wayland compositor
    - python3
    - python3-pip
    - python3-venv
    - nodejs
    - npm
    - plymouth
    - plymouth-themes

  hooks:
    customize:
      - name: deploy-app
        script: |
          #!/bin/bash
          set -e
          
          # Create kiosk user
          useradd -m -s /bin/bash -G video,audio,input,gpio kiosk || true
          
          # Create application directory
          mkdir -p /opt/kiosk-app/{ui,backend}
          
          # Copy application files (these are staged during build)
          if [ -d /tmp/kiosk-app-stage/dist ]; then
              cp -r /tmp/kiosk-app-stage/dist/* /opt/kiosk-app/ui/
          elif [ -d /tmp/kiosk-app-stage/build ]; then
              cp -r /tmp/kiosk-app-stage/build/* /opt/kiosk-app/ui/
          fi
          
          # Setup Python backend if present
          if [ -f /tmp/kiosk-app-stage/requirements.txt ]; then
              python3 -m venv /opt/kiosk-app/venv
              /opt/kiosk-app/venv/bin/pip install -r /tmp/kiosk-app-stage/requirements.txt
              cp -r /tmp/kiosk-app-stage/*.py /opt/kiosk-app/backend/ 2>/dev/null || true
          fi
          
          # Set ownership
          chown -R kiosk:kiosk /opt/kiosk-app
          
      - name: setup-autologin
        script: |
          #!/bin/bash
          set -e
          
          # Configure auto-login for kiosk user
          mkdir -p /etc/systemd/system/getty@tty1.service.d
          cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
          [Service]
          ExecStart=
          ExecStart=-/sbin/agetty --autologin kiosk --noclear %I \$TERM
          EOF
          
      - name: setup-kiosk-service
        script: |
          #!/bin/bash
          set -e
          
          # Create systemd service for kiosk
          cat > /etc/systemd/system/kiosk.service << 'EOF'
          [Unit]
          Description=Kiosk Application
          After=graphical.target
          Wants=graphical.target
          
          [Service]
          User=kiosk
          Group=kiosk
          PAMName=login
          Type=simple
          Environment=XDG_RUNTIME_DIR=/run/user/1000
          Environment=WLR_LIBINPUT_NO_DEVICES=1
          ExecStartPre=/bin/mkdir -p /run/user/1000
          ExecStartPre=/bin/chown kiosk:kiosk /run/user/1000
          ExecStart=/usr/bin/cage -s -- /usr/bin/chromium-browser \
              --kiosk \
              --noerrdialogs \
              --disable-infobars \
              --disable-session-crashed-bubble \
              --disable-restore-session-state \
              --disable-features=TranslateUI \
              --check-for-update-interval=31536000 \
              --enable-features=OverlayScrollbar \
              --enable-gpu-rasterization \
              --enable-zero-copy \
              --ignore-gpu-blocklist \
              file:///opt/kiosk-app/ui/index.html
          Restart=always
          RestartSec=5
          StartLimitIntervalSec=60
          StartLimitBurst=5
          
          [Install]
          WantedBy=graphical.target
          EOF
          
          systemctl enable kiosk.service
YAML

    log OK "Custom layer created"
}

# ══════════════════════════════════════════════════════════════════════════════
# PLYMOUTH BOOT SPLASH
# ══════════════════════════════════════════════════════════════════════════════
create_boot_splash() {
    local splash_dir="${SCRIPT_DIR}/custom-layers/splash"
    
    log STEP "Creating boot splash configuration..."
    
    mkdir -p "$splash_dir"
    
    # Create Plymouth theme
    cat > "$splash_dir/kiosk-splash.yaml" << 'YAML'
layer:
  name: kiosk-splash
  description: Custom boot splash screen
  
  packages:
    - plymouth
    - plymouth-themes
    
  hooks:
    customize:
      - name: setup-splash
        script: |
          #!/bin/bash
          set -e
          
          # Create custom Plymouth theme
          THEME_DIR=/usr/share/plymouth/themes/kiosk
          mkdir -p "$THEME_DIR"
          
          # Create theme configuration
          cat > "$THEME_DIR/kiosk.plymouth" << 'PLYM'
          [Plymouth Theme]
          Name=Kiosk
          Description=Custom kiosk boot splash
          ModuleName=script
          
          [script]
          ImageDir=/usr/share/plymouth/themes/kiosk
          ScriptFile=/usr/share/plymouth/themes/kiosk/kiosk.script
          PLYM
          
          # Create splash script (simple centered logo with spinner)
          cat > "$THEME_DIR/kiosk.script" << 'SCRIPT'
          # Kiosk Boot Splash Script
          
          Window.SetBackgroundTopColor(0.05, 0.05, 0.08);
          Window.SetBackgroundBottomColor(0.02, 0.02, 0.04);
          
          # Load and center logo if present
          logo.image = Image("logo.png");
          logo.sprite = Sprite(logo.image);
          logo.sprite.SetX(Window.GetWidth() / 2 - logo.image.GetWidth() / 2);
          logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2 - 50);
          logo.sprite.SetOpacity(1);
          
          # Create spinner
          spinner_frames = 36;
          for (i = 0; i < spinner_frames; i++) {
              spinner[i] = Image("spinner-" + i + ".png");
          }
          spinner.sprite = Sprite();
          spinner.sprite.SetX(Window.GetWidth() / 2 - spinner[0].GetWidth() / 2);
          spinner.sprite.SetY(Window.GetHeight() / 2 + 80);
          
          progress = 0;
          fun refresh_callback() {
              spinner.sprite.SetImage(spinner[Math.Int(progress / 3) % spinner_frames]);
              progress++;
          }
          Plymouth.SetRefreshFunction(refresh_callback);
          
          # Status message
          message_sprite = Sprite();
          message_sprite.SetPosition(Window.GetWidth() / 2, Window.GetHeight() - 100, 10000);
          
          fun message_callback(text) {
              my_image = Image.Text(text, 0.7, 0.7, 0.75);
              message_sprite.SetImage(my_image);
              message_sprite.SetX(Window.GetWidth() / 2 - my_image.GetWidth() / 2);
          }
          Plymouth.SetMessageFunction(message_callback);
          SCRIPT
          
          # Set as default theme
          plymouth-set-default-theme kiosk
          
          # Update initramfs to include theme
          update-initramfs -u
YAML

    log OK "Boot splash configuration created"
}

# ══════════════════════════════════════════════════════════════════════════════
# WATCHDOG & HEALTH MONITORING
# ══════════════════════════════════════════════════════════════════════════════
create_health_monitor() {
    local monitor_dir="${SCRIPT_DIR}/custom-layers/health"
    
    log STEP "Creating health monitoring system..."
    
    mkdir -p "$monitor_dir"
    
    cat > "$monitor_dir/health-monitor.yaml" << 'YAML'
layer:
  name: health-monitor
  description: System health monitoring and recovery
  
  packages:
    - watchdog
    
  hooks:
    customize:
      - name: setup-watchdog
        script: |
          #!/bin/bash
          set -e
          
          # Enable hardware watchdog
          cat >> /boot/firmware/config.txt << 'EOF'
          
          # Hardware watchdog
          dtparam=watchdog=on
          EOF
          
          # Configure watchdog daemon
          cat > /etc/watchdog.conf << 'EOF'
          watchdog-device = /dev/watchdog
          watchdog-timeout = 15
          max-load-1 = 24
          min-memory = 1
          retry-timeout = 60
          repair-binary = /usr/local/bin/system-repair.sh
          EOF
          
          systemctl enable watchdog
          
      - name: create-health-service
        script: |
          #!/bin/bash
          set -e
          
          # Create system repair script
          cat > /usr/local/bin/system-repair.sh << 'REPAIR'
          #!/bin/bash
          # System repair script - called by watchdog on failures
          
          LOG="/var/log/system-repair.log"
          echo "$(date): Repair triggered" >> "$LOG"
          
          # Try to restart the kiosk service
          if ! systemctl is-active --quiet kiosk.service; then
              echo "$(date): Attempting kiosk restart" >> "$LOG"
              systemctl restart kiosk.service
              sleep 10
              
              if systemctl is-active --quiet kiosk.service; then
                  echo "$(date): Kiosk recovered" >> "$LOG"
                  exit 0
              fi
          fi
          
          # If that didn't work, restart display manager
          echo "$(date): Attempting display restart" >> "$LOG"
          systemctl restart graphical.target
          
          exit 0
          REPAIR
          
          chmod +x /usr/local/bin/system-repair.sh
          
      - name: create-health-check
        script: |
          #!/bin/bash
          set -e
          
          # Create health check script
          cat > /usr/local/bin/health-check.sh << 'HEALTH'
          #!/bin/bash
          # Health check - monitors system and degrades gracefully
          
          # Temperature threshold (mC)
          TEMP_WARN=75000
          TEMP_CRIT=82000
          
          # Memory threshold (%)
          MEM_WARN=85
          MEM_CRIT=95
          
          get_temp() {
              cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0
          }
          
          get_mem_percent() {
              free | awk '/Mem:/ {printf("%.0f", $3/$2 * 100)}'
          }
          
          # Temperature check
          temp=$(get_temp)
          if (( temp > TEMP_CRIT )); then
              logger -t health "CRITICAL: Temperature ${temp}mC - initiating thermal shutdown"
              # Graceful shutdown
              /usr/local/bin/safe-shutdown.sh
          elif (( temp > TEMP_WARN )); then
              logger -t health "WARNING: Temperature ${temp}mC - reducing performance"
              # Could reduce GPU frequency here
          fi
          
          # Memory check
          mem=$(get_mem_percent)
          if (( mem > MEM_CRIT )); then
              logger -t health "CRITICAL: Memory at ${mem}% - restarting kiosk"
              systemctl restart kiosk.service
          elif (( mem > MEM_WARN )); then
              logger -t health "WARNING: Memory at ${mem}%"
          fi
          HEALTH
          
          chmod +x /usr/local/bin/health-check.sh
          
          # Create systemd timer for health checks
          cat > /etc/systemd/system/health-check.service << 'EOF'
          [Unit]
          Description=System health check
          
          [Service]
          Type=oneshot
          ExecStart=/usr/local/bin/health-check.sh
          EOF
          
          cat > /etc/systemd/system/health-check.timer << 'EOF'
          [Unit]
          Description=Run health check every minute
          
          [Timer]
          OnBootSec=60
          OnUnitActiveSec=60
          
          [Install]
          WantedBy=timers.target
          EOF
          
          systemctl enable health-check.timer
YAML

    log OK "Health monitoring system created"
}

# ══════════════════════════════════════════════════════════════════════════════
# SAFE SHUTDOWN
# ══════════════════════════════════════════════════════════════════════════════
create_safe_shutdown() {
    local shutdown_dir="${SCRIPT_DIR}/custom-layers/shutdown"
    
    log STEP "Creating safe shutdown system..."
    
    mkdir -p "$shutdown_dir"
    
    cat > "$shutdown_dir/safe-shutdown.yaml" << 'YAML'
layer:
  name: safe-shutdown
  description: Safe shutdown handling
  
  hooks:
    customize:
      - name: setup-shutdown
        script: |
          #!/bin/bash
          set -e
          
          # Create safe shutdown script
          cat > /usr/local/bin/safe-shutdown.sh << 'SHUTDOWN'
          #!/bin/bash
          # Safe shutdown script - ensures clean unmount
          
          LOG="/var/log/shutdown.log"
          echo "$(date): Safe shutdown initiated" >> "$LOG"
          
          # Stop kiosk gracefully
          systemctl stop kiosk.service 2>/dev/null || true
          
          # Sync filesystems
          sync
          
          # Wait for writes to complete
          sleep 2
          sync
          
          # Now shutdown
          /sbin/shutdown -h now "Safe shutdown complete"
          SHUTDOWN
          
          chmod +x /usr/local/bin/safe-shutdown.sh
          
          # GPIO button support (optional - GPIO3 = pin 5)
          cat > /etc/systemd/system/gpio-shutdown.service << 'EOF'
          [Unit]
          Description=GPIO shutdown button monitor
          After=multi-user.target
          
          [Service]
          Type=simple
          ExecStart=/usr/bin/bash -c 'echo 3 > /sys/class/gpio/export 2>/dev/null; echo in > /sys/class/gpio/gpio3/direction; while true; do if [ "$(cat /sys/class/gpio/gpio3/value)" = "0" ]; then /usr/local/bin/safe-shutdown.sh; fi; sleep 1; done'
          Restart=always
          
          [Install]
          WantedBy=multi-user.target
          EOF
          
          # Enable read-only filesystem overlay (optional but recommended)
          # This protects against SD card corruption from power loss
          cat > /usr/local/bin/toggle-overlay.sh << 'OVERLAY'
          #!/bin/bash
          # Toggle read-only overlay filesystem
          
          CONFIG="/boot/firmware/overlayroot.conf"
          
          if grep -q "overlayroot=disabled" "$CONFIG" 2>/dev/null; then
              sed -i 's/overlayroot=disabled/overlayroot="tmpfs"/' "$CONFIG"
              echo "Overlay enabled - filesystem will be read-only after reboot"
          else
              echo 'overlayroot="tmpfs"' >> "$CONFIG"
              echo "Overlay enabled - filesystem will be read-only after reboot"
          fi
          OVERLAY
          
          chmod +x /usr/local/bin/toggle-overlay.sh
YAML

    log OK "Safe shutdown system created"
}

# ══════════════════════════════════════════════════════════════════════════════
# BUILD CONFIG GENERATION
# ══════════════════════════════════════════════════════════════════════════════
generate_build_config() {
    local app_dir="$1"
    local config_file="${SCRIPT_DIR}/kiosk-config.yaml"
    
    log STEP "Generating build configuration..."
    
    cat > "$config_file" << YAML
# Pi5 Kiosk Forge - Build Configuration
# Generated: $(date -Iseconds)

config:
  name: kiosk-pi5
  description: Custom Kiosk OS for Raspberry Pi 5
  
  device: pi5
  architecture: arm64
  
  # Base system
  base:
    distribution: debian
    release: bookworm
    
  # Image output
  image:
    format: img
    size: 4G
    compress: true
    
  # Layers to include (order matters)
  layers:
    - layer/base-bookworm.yaml
    - layer/firmware-pi5.yaml
    - custom-layers/kiosk-app.yaml
    - custom-layers/splash/kiosk-splash.yaml
    - custom-layers/health/health-monitor.yaml
    - custom-layers/shutdown/safe-shutdown.yaml
    
  # Boot configuration
  boot:
    cmdline: |
      console=serial0,115200 console=tty3 root=PARTUUID=%ROOTUUID% rootfstype=ext4
      elevator=deadline fsck.repair=yes rootwait quiet splash plymouth.ignore-serial-consoles
      logo.nologo vt.global_cursor_default=0 loglevel=3
      
    config.txt: |
      # Pi5 Kiosk Configuration
      arm_64bit=1
      kernel=kernel_2712.img
      
      # Boot behavior
      disable_splash=1
      boot_delay=0
      
      # Display
      hdmi_force_hotplug=1
      hdmi_group=2
      hdmi_mode=82
      
      # GPU Memory (adjust based on Three.js needs)
      gpu_mem=256
      
      # Enable hardware watchdog
      dtparam=watchdog=on
      
      # Power LED off during boot for cleaner look
      dtparam=pwr_led_trigger=none
      dtparam=pwr_led_activelow=off
      
  # Post-build hooks
  hooks:
    post-build:
      - echo "Build complete: \$(date)" > /etc/kiosk-build-info
YAML

    log OK "Build configuration generated: $config_file"
}

# ══════════════════════════════════════════════════════════════════════════════
# SD CARD FLASHING
# ══════════════════════════════════════════════════════════════════════════════
list_removable_devices() {
    log INFO "Available removable devices:"
    echo ""
    
    lsblk -d -o NAME,SIZE,TYPE,TRAN,MODEL | grep -E "(usb|mmc)" || {
        log WARN "No removable devices found. Insert SD card and try again."
        return 1
    }
    
    echo ""
}

flash_to_sd() {
    local image_file="$1"
    local target_device="${2:-}"
    
    log STEP "Preparing to flash image..."
    
    if [[ ! -f "$image_file" ]]; then
        die "Image file not found: $image_file"
    fi
    
    if [[ -z "$target_device" ]]; then
        list_removable_devices
        echo -n "Enter device to flash (e.g., sdb, mmcblk0): "
        read -r target_device
    fi
    
    # Normalize device path
    if [[ ! "$target_device" =~ ^/dev/ ]]; then
        target_device="/dev/$target_device"
    fi
    
    # Safety checks
    if [[ ! -b "$target_device" ]]; then
        die "Not a block device: $target_device"
    fi
    
    # Check it's removable
    local device_name
    device_name=$(basename "$target_device")
    
    if [[ ! -f "/sys/block/$device_name/removable" ]] || \
       [[ "$(cat "/sys/block/$device_name/removable")" != "1" ]]; then
        log WARN "Device $target_device may not be removable!"
        echo -n "Are you ABSOLUTELY SURE you want to flash to $target_device? [yes/NO]: "
        read -r confirm
        if [[ "$confirm" != "yes" ]]; then
            die "Aborted by user"
        fi
    fi
    
    # Unmount any mounted partitions
    log INFO "Unmounting any mounted partitions..."
    for part in "${target_device}"*; do
        if mountpoint -q "$part" 2>/dev/null; then
            sudo umount "$part" || true
        fi
    done
    
    # Get image size for progress
    local image_size
    image_size=$(stat -c %s "$image_file")
    
    log INFO "Flashing ${image_file} to ${target_device}..."
    log INFO "Image size: $(numfmt --to=iec-i --suffix=B "$image_size")"
    log WARN "This will ERASE ALL DATA on ${target_device}"
    
    echo -n "Continue? [y/N]: "
    read -r confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        die "Aborted by user"
    fi
    
    # Flash with progress
    if command -v pv &>/dev/null; then
        pv "$image_file" | sudo dd of="$target_device" bs=4M conv=fsync status=none
    else
        sudo dd if="$image_file" of="$target_device" bs=4M conv=fsync status=progress
    fi
    
    # Sync and verify
    log INFO "Syncing..."
    sudo sync
    
    log OK "Flash complete!"
    log INFO "You can now safely remove the SD card"
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN BUILD PROCESS
# ══════════════════════════════════════════════════════════════════════════════
build_image() {
    local app_dir="$1"
    
    log STEP "Starting image build process..."
    
    # Create work directories
    mkdir -p "$WORK_DIR" "$OUTPUT_DIR"
    
    # Stage application files for inclusion
    local stage_dir="$WORK_DIR/app-stage"
    mkdir -p "$stage_dir"
    
    log INFO "Staging application files..."
    rsync -a --delete "$app_dir/" "$stage_dir/"
    
    # Run rpi-image-gen build
    log INFO "Building image with rpi-image-gen..."
    
    local config_file="${SCRIPT_DIR}/kiosk-config.yaml"
    local output_image="${OUTPUT_DIR}/kiosk-pi5-$(date +%Y%m%d-%H%M%S).img"
    
    # Check if rpi-image-gen is set up
    if [[ ! -d "$RPI_IMAGE_GEN_DIR" ]]; then
        setup_rpi_image_gen
    fi
    
    # For now, create a simplified image using direct approach
    # (Full rpi-image-gen integration would require more setup)
    
    log INFO "Creating bootable image..."
    
    # This is a simplified approach - for production, use full rpi-image-gen
    create_direct_image "$app_dir" "$output_image"
    
    log OK "Image built: $output_image"
    
    # Compress image
    if command -v xz &>/dev/null; then
        log INFO "Compressing image..."
        xz -T0 -k "$output_image"
        log OK "Compressed: ${output_image}.xz"
    fi
    
    echo ""
    log OK "Build complete!"
    echo -e "   Image: ${BOLD}${output_image}${NC}"
    echo ""
}

create_direct_image() {
    local app_dir="$1"
    local output_image="$2"
    
    # Download base image if needed
    local base_image="${WORK_DIR}/base-raspi-os.img"
    local base_url="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
    
    if [[ ! -f "$base_image" ]]; then
        log INFO "Downloading Raspberry Pi OS Lite..."
        retry $MAX_RETRIES $RETRY_DELAY "download base image" \
            wget -q --show-progress -O "${base_image}.xz" "$base_url"
        
        log INFO "Extracting base image..."
        xz -d "${base_image}.xz"
    fi
    
    # Copy base image
    log INFO "Copying base image..."
    cp "$base_image" "$output_image"
    
    # Expand image to 4GB
    log INFO "Expanding image..."
    truncate -s 4G "$output_image"
    
    # Setup loop device
    LOOP_DEVICE=$(sudo losetup -fP --show "$output_image")
    log INFO "Loop device: $LOOP_DEVICE"
    
    # Expand root partition
    sudo parted -s "$LOOP_DEVICE" resizepart 2 100%
    sudo e2fsck -f "${LOOP_DEVICE}p2" || true
    sudo resize2fs "${LOOP_DEVICE}p2"
    
    # Mount partitions
    local mnt_dir="${WORK_DIR}/mnt"
    mkdir -p "$mnt_dir"
    sudo mount "${LOOP_DEVICE}p2" "$mnt_dir"
    sudo mount "${LOOP_DEVICE}p1" "$mnt_dir/boot/firmware"
    
    # Install application
    log INFO "Installing application..."
    sudo mkdir -p "$mnt_dir/opt/kiosk-app/ui"
    
    if [[ -d "$app_dir/dist" ]]; then
        sudo cp -r "$app_dir/dist/"* "$mnt_dir/opt/kiosk-app/ui/"
    elif [[ -d "$app_dir/build" ]]; then
        sudo cp -r "$app_dir/build/"* "$mnt_dir/opt/kiosk-app/ui/"
    fi
    
    # Install kiosk service
    log INFO "Installing kiosk service..."
    sudo tee "$mnt_dir/etc/systemd/system/kiosk.service" > /dev/null << 'EOF'
[Unit]
Description=Kiosk Application
After=graphical.target
Wants=graphical.target

[Service]
User=kiosk
Group=kiosk
PAMName=login
Type=simple
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=WLR_LIBINPUT_NO_DEVICES=1
ExecStartPre=/bin/mkdir -p /run/user/1000
ExecStartPre=/bin/chown kiosk:kiosk /run/user/1000
ExecStart=/usr/bin/cage -s -- /usr/bin/chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --enable-features=OverlayScrollbar \
    --enable-gpu-rasterization \
    --enable-zero-copy \
    --ignore-gpu-blocklist \
    file:///opt/kiosk-app/ui/index.html
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

[Install]
WantedBy=graphical.target
EOF

    # Create first-boot setup script
    sudo tee "$mnt_dir/usr/local/bin/first-boot-setup.sh" > /dev/null << 'EOF'
#!/bin/bash
# First boot setup - runs once then disables itself

LOG="/var/log/first-boot.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== First Boot Setup: $(date) ==="

# Install required packages
apt-get update
apt-get install -y cage chromium-browser plymouth watchdog

# Create kiosk user
useradd -m -s /bin/bash -G video,audio,input kiosk || true

# Set ownership
chown -R kiosk:kiosk /opt/kiosk-app

# Enable kiosk service
systemctl enable kiosk.service

# Configure auto-login
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << 'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin kiosk --noclear %I $TERM
AUTOLOGIN

# Set graphical target
systemctl set-default graphical.target

# Configure quiet boot
sed -i 's/console=tty1/console=tty3 quiet splash loglevel=0/' /boot/firmware/cmdline.txt

# Disable this script
systemctl disable first-boot-setup.service
rm /etc/systemd/system/first-boot-setup.service

echo "=== First Boot Setup Complete ==="
reboot
EOF

    sudo chmod +x "$mnt_dir/usr/local/bin/first-boot-setup.sh"

    # Create first-boot service
    sudo tee "$mnt_dir/etc/systemd/system/first-boot-setup.service" > /dev/null << 'EOF'
[Unit]
Description=First Boot Setup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/first-boot-setup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

    # Enable first-boot service
    sudo ln -sf /etc/systemd/system/first-boot-setup.service \
        "$mnt_dir/etc/systemd/system/multi-user.target.wants/first-boot-setup.service"

    # Cleanup
    log INFO "Finalizing image..."
    sudo sync
    sudo umount -R "$mnt_dir"
    sudo losetup -d "$LOOP_DEVICE"
    unset LOOP_DEVICE
    
    log OK "Direct image creation complete"
}

# ══════════════════════════════════════════════════════════════════════════════
# CLI INTERFACE
# ══════════════════════════════════════════════════════════════════════════════
usage() {
    cat << EOF
${BOLD}Pi5 Kiosk Forge${NC} - Raspberry Pi 5 Image Builder

${BOLD}USAGE:${NC}
    $SCRIPT_NAME <command> [options]

${BOLD}COMMANDS:${NC}
    build <app-dir>     Build a flashable image from your application
    flash <image> [dev] Flash an image to SD card
    check               Run system checks only
    setup               Setup build environment
    clean               Clean build artifacts

${BOLD}OPTIONS:${NC}
    -h, --help          Show this help
    -v, --version       Show version
    -d, --debug         Enable debug output

${BOLD}EXAMPLES:${NC}
    # Build image from your app
    $SCRIPT_NAME build ~/my-kiosk-app

    # Flash to SD card
    $SCRIPT_NAME flash build/output/kiosk-pi5.img

    # Flash to specific device
    $SCRIPT_NAME flash build/output/kiosk-pi5.img sdb

${BOLD}WORKFLOW:${NC}
    1. Build your TSX/React/Three.js app (npm run build)
    2. Run: $SCRIPT_NAME build /path/to/your/app
    3. Run: $SCRIPT_NAME flash build/output/kiosk-pi5-*.img
    4. Insert SD card into Pi 5 and power on

EOF
}

main() {
    # Parse global flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            -v|--version)
                echo "Pi5 Kiosk Forge v$VERSION"
                exit 0
                ;;
            -d|--debug)
                DEBUG=1
                shift
                ;;
            *)
                break
                ;;
        esac
    done
    
    local command="${1:-}"
    shift || true
    
    banner
    
    case "$command" in
        build)
            local app_dir="${1:-}"
            if [[ -z "$app_dir" ]]; then
                die "Usage: $SCRIPT_NAME build <app-directory>"
            fi
            
            # Convert to absolute path
            app_dir="$(cd "$app_dir" && pwd)"
            
            check_dependencies
            check_privileges
            check_disk_space
            validate_app_source "$app_dir"
            
            # Create custom layers
            create_custom_layer "$app_dir"
            create_boot_splash
            create_health_monitor
            create_safe_shutdown
            generate_build_config "$app_dir"
            
            # Build the image
            build_image "$app_dir"
            ;;
            
        flash)
            local image="${1:-}"
            local device="${2:-}"
            
            if [[ -z "$image" ]]; then
                # Find latest image
                image=$(ls -t "${OUTPUT_DIR}"/kiosk-pi5-*.img 2>/dev/null | head -1)
                if [[ -z "$image" ]]; then
                    die "No image file specified and no images found in ${OUTPUT_DIR}"
                fi
                log INFO "Using latest image: $image"
            fi
            
            flash_to_sd "$image" "$device"
            ;;
            
        check)
            check_dependencies
            check_privileges
            check_disk_space
            log OK "All checks passed!"
            ;;
            
        setup)
            check_dependencies
            check_privileges
            setup_rpi_image_gen
            log OK "Setup complete!"
            ;;
            
        clean)
            log INFO "Cleaning build artifacts..."
            rm -rf "${WORK_DIR}"
            log OK "Clean complete"
            ;;
            
        "")
            usage
            exit 1
            ;;
            
        *)
            die "Unknown command: $command. Use --help for usage."
            ;;
    esac
}

main "$@"
