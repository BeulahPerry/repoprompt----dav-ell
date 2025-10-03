#!/bin/bash
set -e

cd ..

# Build script for creating ARM and AMD64 binaries
echo "Building repoprompt for ARM and AMD64..."

# Create dist directory
echo "Creating dist directory..."
mkdir -p dist

# Build for ARM (native on M-series Mac)
echo "Building ARM binary (native)..."
cargo build --release

# Cross-compile for AMD64 Linux
echo "Building AMD64 binary (cross-compilation)..."
cross build --release --target x86_64-unknown-linux-musl

# Copy binaries to dist
echo "Copying binaries to dist/..."
cp target/release/repoprompt dist/repoprompt.arm64
cp target/x86_64-unknown-linux-musl/release/repoprompt dist/repoprompt.amd64

# Show results
echo ""
echo "Build complete! Binaries:"
ls -lh dist/

