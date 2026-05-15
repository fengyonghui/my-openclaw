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

# Copy built artifacts into correct subdirectories
cp -r backend/dist "$OUTPUT/backend/"
# Use rsync -a --copy-unsafe-links: only dereference symlinks pointing outside
# the source tree (avvio's symlinks point into .pnpm/ which IS outside), so it
# copies each package's content to its top-level location as a real directory.
rsync -a --copy-unsafe-links backend/node_modules/ "$OUTPUT/backend/node_modules/"
cp -r ui/dist "$OUTPUT/ui/"

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
