#!/bin/bash
# Usage: ./scripts/package-release.sh [version]
# e.g.: ./scripts/package-release.sh v0.3.33

set -e

VERSION=${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "0.0.0")}
OUTPUT="my-openclaw-${VERSION}-dist"

echo "Packaging my-openclaw ${VERSION}..."

# Sync repo package.json versions to the release version
# (so /api/version and the UI footer match the published release)
sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"${VERSION#v}\"/" package.json backend/package.json ui/package.json
grep -H '"version"' package.json backend/package.json ui/package.json

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

# Copy root .npmrc to override user's global Aliyun mirror
cp .npmrc "$OUTPUT/" 2>/dev/null || true

# Copy README.md
cp README.md "$OUTPUT/"

# Copy startup scripts
cp scripts/start-windows.cmd "$OUTPUT/"
cp scripts/start-windows.ps1 "$OUTPUT/"
cp scripts/start-linux.sh "$OUTPUT/"
chmod +x "$OUTPUT/start-linux.sh"

# Substitute %VERSION% placeholder in startup scripts
sed -i "s/%VERSION%/${VERSION#v}/g" "$OUTPUT/start-windows.cmd" "$OUTPUT/start-windows.ps1" "$OUTPUT/start-linux.sh"

# Ensure the .cmd script has CRLF line endings (sed strips \r; cmd.exe needs CRLF)
sed -i 's/$/\r/' "$OUTPUT/start-windows.cmd"

# Create a clean root package.json
cat > "$OUTPUT/package.json" << EOF
{
  "name": "my-openclaw",
  "version": "${VERSION}",
  "private": true,
  "type": "module",
  "description": "AI coding agent with project isolation and team collaboration",
  "scripts": {
    "install": "echo Run: npm install --prefix backend --registry https://registry.npmjs.org/",
    "start": "echo Run: npm start --prefix backend"
  },
  "engines": {
    "node": ">=18"
  }
}
EOF

# Package as tar.gz
tar -czvf "${OUTPUT}.tar.gz" "$OUTPUT"

# Package as zip: prefer zip, fall back to Windows bsdtar (-a picks zip format from .zip extension)
# bsdtar ships with Windows 10+ (System32\tar.exe) and produces DEFLATE-compressed zips
if command -v zip &> /dev/null; then
  zip -rq "${OUTPUT}.zip" "$OUTPUT"
  echo "Done: ${OUTPUT}.tar.gz + ${OUTPUT}.zip"
elif command -v /c/Windows/System32/tar.exe &> /dev/null; then
  /c/Windows/System32/tar.exe -a -cf "${OUTPUT}.zip" "$OUTPUT"
  echo "Done: ${OUTPUT}.tar.gz + ${OUTPUT}.zip (via bsdtar)"
else
  echo "Done: ${OUTPUT}.tar.gz (no zip tool available)"
fi

# Cleanup
rm -rf "$OUTPUT"
