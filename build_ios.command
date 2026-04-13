#!/bin/bash
# ─────────────────────────────────────────────────────────────
# HALT iOS Build — Build and push to TestFlight
#
# Golden Pipeline:
#   1. Git pull on Mac
#   2. Run this script
#   3. Xcode opens → Archive → TestFlight
#   4. Git push any changes back
#
# Prerequisites:
#   • Xcode + iOS SDK
#   • Rust with aarch64-apple-ios target:
#     rustup target add aarch64-apple-ios
#   • Cocoapods: gem install cocoapods
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

export HALT_MODELS_DIR="$(pwd)/models"
export HALT_DATA_DIR="$(pwd)/patients"

echo ""
echo "  ┌──────────────────────────────────────────┐"
echo "  │  HALT — iOS TestFlight Build             │"
echo "  │  Rust-native · No Python · Air-gapped    │"
echo "  └──────────────────────────────────────────┘"
echo ""

# ── Verify iOS target ────────────────────────────────────────
if ! rustup target list --installed | grep -q "aarch64-apple-ios"; then
    echo "  Adding iOS build target..."
    rustup target add aarch64-apple-ios
fi

# ── Install deps ─────────────────────────────────────────────
if [ ! -d "viewer/node_modules" ]; then
    echo "  Installing frontend dependencies..."
    cd viewer && npm install && cd ..
fi

# ── Initialize iOS project (first time only) ─────────────────
if [ ! -d "viewer/src-tauri/gen/apple" ]; then
    echo "  Initializing Tauri iOS project..."
    cd viewer
    npx tauri ios init
    cd ..
    echo ""
fi

# ── Build ─────────────────────────────────────────────────────
echo "  Building iOS target..."
echo "  This will compile Rust for aarch64-apple-ios"
echo ""
cd viewer
npx tauri ios build

echo ""
echo "  ┌──────────────────────────────────────────┐"
echo "  │  ✅ Build complete                       │"
echo "  │                                          │"
echo "  │  Next steps:                             │"
echo "  │  1. Open Xcode (the project should open) │"
echo "  │  2. Select your Team in Signing           │"
echo "  │  3. Product → Archive                     │"
echo "  │  4. Distribute → TestFlight               │"
echo "  │  5. git push to sync                      │"
echo "  └──────────────────────────────────────────┘"
echo ""
