#!/usr/bin/env bash
#
# Build the Arti core as a fat static library for iOS.
#
# Produces ios/lib/libkhabardar_tor.a covering device (arm64) and simulator
# (arm64 + x86_64). Run before `pod install`; the podspec expects the artifact
# and the build fails loudly without it, which is correct — shipping an app
# whose Tor cannot start would be far worse than a build error.
#
#   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
#   npm run build:ios --workspace expo-tor

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$HERE/../rust"
OUT_DIR="$HERE/../ios/lib"

DEVICE_TARGET="aarch64-apple-ios"
SIM_ARM_TARGET="aarch64-apple-ios-sim"
SIM_X86_TARGET="x86_64-apple-ios"

echo "==> Building Arti for iOS targets"
for target in "$DEVICE_TARGET" "$SIM_ARM_TARGET" "$SIM_X86_TARGET"; do
  if ! rustup target list --installed | grep -q "^${target}$"; then
    echo "    missing rust target ${target}; installing"
    rustup target add "$target"
  fi
  echo "    ${target}"
  (cd "$RUST_DIR" && cargo build --release --target "$target")
done

mkdir -p "$OUT_DIR"

# Simulator slices share a platform, so they can be merged with lipo. The
# device slice cannot be merged with them — same architecture (arm64),
# different platform — which is exactly what XCFrameworks exist to express.
SIM_FAT="$RUST_DIR/target/libkhabardar_tor_sim.a"
lipo -create \
  "$RUST_DIR/target/$SIM_ARM_TARGET/release/libkhabardar_tor.a" \
  "$RUST_DIR/target/$SIM_X86_TARGET/release/libkhabardar_tor.a" \
  -output "$SIM_FAT"

echo "==> Assembling XCFramework"
rm -rf "$OUT_DIR/KhabardarTor.xcframework"
xcodebuild -create-xcframework \
  -library "$RUST_DIR/target/$DEVICE_TARGET/release/libkhabardar_tor.a" \
  -headers "$HERE/../ios" \
  -library "$SIM_FAT" \
  -headers "$HERE/../ios" \
  -output "$OUT_DIR/KhabardarTor.xcframework"

# The podspec links -lkhabardar_tor from LIBRARY_SEARCH_PATHS, so also drop the
# device slice where it expects it. CI builds for device; the simulator slice
# is picked up from the XCFramework.
cp "$RUST_DIR/target/$DEVICE_TARGET/release/libkhabardar_tor.a" "$OUT_DIR/libkhabardar_tor.a"

echo "==> Done: $OUT_DIR"
