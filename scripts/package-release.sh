#!/bin/bash
# Usage: ./scripts/package-release.sh [version]
# e.g.: ./scripts/package-release.sh v0.2.0

set -e

VERSION=${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "0.0.0")}
OUTPUT="my-openclaw-${VERSION}-dist"

echo "Packaging my-openclaw ${VERSION}..."

# Clean up
rm -rf "$OUTPUT" "${OUTPUT}.tar.gz" "${OUTPUT}.zip"

# Create output directory
mkdir -p "$OUTPUT"

# Copy built artifacts
cp -r backend/dist "$OUTPUT/"
cp -r backend/node_modules "$OUTPUT/"
cp -r ui/dist "$OUTPUT/"

# Create a clean package.json for distribution (no devDependencies)
cat > "$OUTPUT/package.json" << 'EOF'
{
  "name": "my-openclaw",
  "version": "VERSION_PLACEHOLDER",
  "private": true,
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

# Copy root files needed
cp "$OUTPUT/backend/dist/index.js" "$OUTPUT/backend/" 2>/dev/null || true

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
