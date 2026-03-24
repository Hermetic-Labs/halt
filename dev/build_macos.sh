#!/bin/bash
# =============================================================================
# HALT — macOS Build Script
# =============================================================================
# Run this ON A MAC to create the macOS distribution ZIP.
#
# What it does:
#   1. Downloads standalone Python 3.13 (no system deps needed)
#   2. Installs all pip dependencies into it
#   3. Packages everything into a ZIP ready for R2 upload
#
# Usage:
#   chmod +x dev/build_macos.sh
#   ./dev/build_macos.sh              # Build for current arch (arm64 or x64)
#   ./dev/build_macos.sh --upload     # Build + upload to R2
#
# Requirements: curl, tar (both pre-installed on macOS)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VERSION="1.0.1-alpha"

# ── Detect architecture ──────────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    PYTHON_ARCH="aarch64-apple-darwin"
    ZIP_ARCH="arm64"
elif [ "$ARCH" = "x86_64" ]; then
    PYTHON_ARCH="x86_64-apple-darwin"
    ZIP_ARCH="x64"
else
    echo "[ERROR] Unsupported architecture: $ARCH"
    exit 1
fi

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   HALT — macOS Build ($ZIP_ARCH)          ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""

# ── Configuration ─────────────────────────────────────────────────────────────
PYTHON_VERSION="3.13.3"
PYTHON_RELEASE="20250517"
PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${PYTHON_ARCH}-install_only.tar.gz"

RUNTIME_DIR="$REPO_ROOT/runtime"
PYTHON_DIR="$RUNTIME_DIR/python"
BUILD_DIR="$REPO_ROOT/builds"
ZIP_NAME="HALT-v${VERSION}-macOS-${ZIP_ARCH}"
ZIP_PATH="$BUILD_DIR/${ZIP_NAME}.zip"

# ── Step 1: Download standalone Python ────────────────────────────────────────
if [ -f "$PYTHON_DIR/bin/python3" ]; then
    echo "  [SKIP]  Standalone Python already exists at $PYTHON_DIR"
else
    echo "  [1/4]   Downloading standalone Python ${PYTHON_VERSION} (${ZIP_ARCH})..."
    echo "          From: $PYTHON_URL"

    TARBALL="/tmp/halt-python-standalone.tar.gz"
    curl -L --progress-bar -o "$TARBALL" "$PYTHON_URL"

    echo "  [UNZIP] Extracting to runtime/python/..."
    mkdir -p "$RUNTIME_DIR"
    tar -xzf "$TARBALL" -C "$RUNTIME_DIR"
    rm "$TARBALL"

    # python-build-standalone extracts to "python/" inside RUNTIME_DIR
    if [ ! -f "$PYTHON_DIR/bin/python3" ]; then
        echo "[ERROR] Python binary not found after extraction"
        echo "        Expected: $PYTHON_DIR/bin/python3"
        ls -la "$RUNTIME_DIR/"
        exit 1
    fi

    echo "  [OK]    Python $(${PYTHON_DIR}/bin/python3 --version) ready"
fi

PYTHON="$PYTHON_DIR/bin/python3"

# ── Step 2: Install dependencies ──────────────────────────────────────────────
echo "  [2/4]   Installing pip dependencies..."

# Upgrade pip first
"$PYTHON" -m pip install --upgrade pip --quiet

# Install from requirements.txt
"$PYTHON" -m pip install -r "$REPO_ROOT/requirements.txt" --quiet

# Install llama-cpp-python with Metal support (Apple GPU acceleration)
echo "  [GPU]   Installing llama-cpp-python with Metal support..."
CMAKE_ARGS="-DGGML_METAL=on" "$PYTHON" -m pip install llama-cpp-python --quiet --force-reinstall --no-cache-dir

echo "  [OK]    $(${PYTHON} -m pip list --format=columns 2>/dev/null | wc -l | tr -d ' ') packages installed"

# ── Step 3: Verify critical packages ─────────────────────────────────────────
echo "  [3/4]   Verifying critical packages..."
FAILED=0

for pkg in fastapi uvicorn llama_cpp_python kokoro_onnx onnxruntime faster_whisper ctranslate2; do
    if "$PYTHON" -c "import $pkg" 2>/dev/null; then
        echo "          ✓ $pkg"
    else
        echo "          ✗ $pkg — FAILED"
        FAILED=1
    fi
done

if [ "$FAILED" -eq 1 ]; then
    echo "  [ERROR] Some packages failed to import. Check errors above."
    exit 1
fi

echo "  [OK]    All critical packages verified"

# ── Step 4: Create distribution ZIP ──────────────────────────────────────────
echo "  [4/4]   Creating distribution ZIP..."
mkdir -p "$BUILD_DIR"

# Create a staging directory
STAGE_DIR="/tmp/${ZIP_NAME}"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Copy everything needed
echo "          Copying api/..."
cp -r "$REPO_ROOT/api" "$STAGE_DIR/"
echo "          Copying viewer/..."
cp -r "$REPO_ROOT/viewer" "$STAGE_DIR/"
echo "          Copying triage/..."
cp -r "$REPO_ROOT/triage" "$STAGE_DIR/"
echo "          Copying runtime/..."
cp -r "$RUNTIME_DIR" "$STAGE_DIR/"
echo "          Copying assets/..."
cp -r "$REPO_ROOT/assets" "$STAGE_DIR/"
echo "          Copying start.py..."
cp "$REPO_ROOT/start.py" "$STAGE_DIR/"
cp "$REPO_ROOT/requirements.txt" "$STAGE_DIR/"
cp "$REPO_ROOT/README.md" "$STAGE_DIR/"
cp "$REPO_ROOT/LICENSE" "$STAGE_DIR/"

# Models directory (empty — auto-downloads on first run)
mkdir -p "$STAGE_DIR/models"

# Remove __pycache__, .pyc, .git
find "$STAGE_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$STAGE_DIR" -name "*.pyc" -delete 2>/dev/null || true
find "$STAGE_DIR" -name ".git" -exec rm -rf {} + 2>/dev/null || true
# Remove _source raw data
rm -rf "$STAGE_DIR/triage/_source/icd10cm-2025" 2>/dev/null || true
rm -f "$STAGE_DIR/triage/_source/icd10cm-2025.zip" 2>/dev/null || true

# Create ZIP
cd /tmp
rm -f "$ZIP_PATH"
zip -r -q "$ZIP_PATH" "$ZIP_NAME"
rm -rf "$STAGE_DIR"

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
echo "  [OK]    Created: $ZIP_PATH ($ZIP_SIZE)"

# ── Optional: Upload to R2 ───────────────────────────────────────────────────
if [ "$1" = "--upload" ]; then
    echo ""
    echo "  [R2]    Uploading to Cloudflare R2..."
    "$PYTHON" -c "
import boto3, os
s3 = boto3.client('s3',
    endpoint_url=f'https://{os.environ[\"R2_ACCOUNT_ID\"]}.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['R2_ACCESS_KEY'],
    aws_secret_access_key=os.environ['R2_SECRET_KEY'],
    region_name='auto')
s3.upload_file('$ZIP_PATH', 'hermetic-labs-triage', '${ZIP_NAME}.zip')
print('  [OK]    Uploaded to R2')
"
fi

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   Build complete!                         ║"
echo "  ║                                           ║"
echo "  ║   ZIP: builds/${ZIP_NAME}.zip             ║"
echo "  ║   Size: $ZIP_SIZE                         ║"
echo "  ║                                           ║"
echo "  ║   To test:                                ║"
echo "  ║     unzip builds/${ZIP_NAME}.zip           ║"
echo "  ║     cd ${ZIP_NAME}                         ║"
echo "  ║     runtime/python/bin/python3 start.py    ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""
