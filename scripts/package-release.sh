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

# Copy backend/package.json (needed for: npm install --prefix backend)
cp backend/package.json "$OUTPUT/backend/"

# Create root .npmrc to override user's global Aliyun mirror
cat > "$OUTPUT/.npmrc" << 'NPMRC'
registry=https://registry.npmjs.org/
NPMRC

# Create a clean root package.json
cat > "$OUTPUT/package.json" << 'EOF'
{
  "name": "my-openclaw",
  "version": "VERSION_PLACEHOLDER",
  "private": true,
  "type": "module",
  "description": "AI coding agent with project isolation and team collaboration",
  "scripts": {
    "install": "node $npm_execpath install --prefix backend --registry https://registry.npmjs.org/",
    "start": "node $npm_execpath run start --prefix backend"
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
