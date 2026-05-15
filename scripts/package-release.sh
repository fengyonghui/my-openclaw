#!/bin/bash
# Usage: ./scripts/package-release.sh [version]
# e.g.: ./scripts/package-release.sh v0.2.0

set -e

VERSION=${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "0.0.0")}
OUTPUT="my-openclaw-${VERSION}-dist"

echo "Packaging my-openclaw ${VERSION}..."

# Clean up
rm -rf "$OUTPUT" "${OUTPUT}.tar.gz" "${OUTPUT}.zip"

# Create subdirectories
mkdir -p "$OUTPUT/backend"
mkdir -p "$OUTPUT/ui"

# Copy built artifacts
cp -r backend/dist "$OUTPUT/backend/"
cp -r ui/dist "$OUTPUT/ui/"

# Copy node_modules with rsync --copy-dirlinks (dereferences top-level symlinked dirs)
rsync -a --copy-dirlinks backend/node_modules/ "$OUTPUT/backend/node_modules/"

# Flatten pnpm v11 structure: for each package in .pnpm/<pkg>@<ver>/node_modules/<pkg>/,
# copy its content to backend/node_modules/<pkg>/ if not already there as a real dir.
# This ensures non-hoisted packages (like avvio) are also accessible.
if [ -d "$OUTPUT/backend/node_modules/.pnpm" ]; then
  echo "  Flattening pnpm structure..."
  shopt -s nullglob
  for nested_pkg in "$OUTPUT/backend/node_modules/.pnpm"/*/node_modules/*/; do
    [ -d "$nested_pkg" ] || continue
    pkgname=$(basename "$nested_pkg")

    # Skip if already exists as real dir at top level
    top_level="$OUTPUT/backend/node_modules/$pkgname"
    if [ -d "$top_level" ] && [ ! -L "$top_level" ]; then
      continue
    fi

    echo "  Installing: $pkgname"
    rm -rf "$top_level"
    cp -r "$nested_pkg/." "$top_level/"
  done

  # Remove the now-redundant .pnpm store
  echo "  Removing .pnpm store..."
  rm -rf "$OUTPUT/backend/node_modules/.pnpm"
fi

# Create a clean package.json for distribution (no devDependencies)
cat > "$OUTPUT/package.json" << 'EOF'
{
  "name": "my-openclaw",
  "version": "VERSION_PLACEHOLDER",
  "private": true,
  "type": "module",
  "description": "AI coding agent with project isolation and team collaboration",
  "scripts": {
    "start": "node backend/dist/index.js"
  },
  "engines": {
    "node": ">=18"
  }
}
EOF
sed -i "s/VERSION_PLACEHOLDER/$VERSION/" "$OUTPUT/package.json"

# Package as tar.gz
tar -czvf "${OUTPUT}.tar.gz" "$OUTPUT"

# Package as zip (if zip is available)
if command -v zip &> /dev/null; then
  zip -rq "${OUTPUT}.zip" "$OUTPUT"
  echo "Done: ${OUTPUT}.tar.gz + ${OUTPUT}.zip"
else
  echo "Done: ${OUTPUT}.tar.gz (zip not available)"
fi

# Cleanup
rm -rf "$OUTPUT"
