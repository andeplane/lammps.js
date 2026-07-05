#!/bin/bash
set -e

echo "Setting up Emscripten SDK..."

# Install system dependencies
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  cmake \
  && sudo rm -rf /var/lib/apt/lists/*

# Install Emscripten SDK, pinned to the version in emsdk_manifest.txt
# (the same version CI uses — its cache key hashes that file).
EMSDK_DIR="${EMSDK_PATH:-$HOME/.emsdk}"
EMSDK_VERSION="$(tr -d '[:space:]' < emsdk_manifest.txt)"

if [ ! -d "$EMSDK_DIR" ]; then
  echo "Installing Emscripten SDK $EMSDK_VERSION..."
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi

cd "$EMSDK_DIR"
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"
source ./emsdk_env.sh
cd - > /dev/null

# Verify installation
echo "Verifying Emscripten installation..."
emcc --version

# Make the environment available in all shells; cpp/build.py needs EMSDK_PATH.
if ! grep -q "source.*emsdk_env.sh" "$HOME/.bashrc"; then
  {
    echo ""
    echo "# Emscripten SDK"
    echo "export EMSDK_PATH=\"$EMSDK_DIR\""
    echo "if [ -f \"$EMSDK_DIR/emsdk_env.sh\" ]; then"
    echo "  source \"$EMSDK_DIR/emsdk_env.sh\" > /dev/null 2>&1"
    echo "fi"
  } >> "$HOME/.bashrc"
fi

# Install node dependencies
npm ci

echo "Setup complete! Build with: npm run build   Test with: npm test"
