#!/usr/bin/env bash
#
# Drop shared objects cargo-ndk copied that we never actually load.
#
# cargo-ndk copies every .so it finds in the target directory, including ones
# produced for Rust's own dependency graph. `libark_circom-<hash>.so` is the
# usual offender: the prover links it statically, so the file is never opened at
# runtime and only adds to the APK.
#
# Verified rather than assumed — `readelf -d libkhabardar_zkprove.so` lists only
# liblog, libdl, libm and libc under NEEDED.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JNI_DIR="${1:-$HERE/../android/src/main/jniLibs}"
KEEP="libkhabardar_zkprove.so"

if [ ! -d "$JNI_DIR" ]; then
  echo "no jniLibs at $JNI_DIR — nothing to prune"
  exit 0
fi

removed=0
while IFS= read -r -d '' so; do
  if [ "$(basename "$so")" != "$KEEP" ]; then
    echo "  pruning $(basename "$so") ($(du -h "$so" | cut -f1))"
    rm -f "$so"
    removed=$((removed + 1))
  fi
done < <(find "$JNI_DIR" -name "*.so" -print0 2>/dev/null)

echo "pruned $removed unused shared object(s)"
