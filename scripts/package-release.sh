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
# Use rsync -a --copy-dirlinks: when symlink points to a directory (like avvio -> .pnpm/.../node_modules/avvio),
# --copy-dirlinks copies the directory CONTENT into the destination, not into the symlink target.
cp -r backend/dist "$OUTPUT/backend/"
rsync -a --copy-dirlinks backend/node_modules/ "$OUTPUT/backend/node_modules/"

# Post-process: if pnpm symlinks survived, dereference them explicitly
# pnpm v11 stores packages as: backend/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/
# and creates symlinks: backend/node_modules/<pkg> -> ../.pnpm/<pkg>@<ver>/node_modules/<pkg>/
# When these symlinks survive rsync, Node can't find them. Fix by copying target content.
for symlink in "$OUTPUT/backend/node_modules"/*; do
  if [ -L "$symlink" ]; then
    target=$(readlink "$symlink")
    # Resolve relative target: ../.pnpm/xxx/node_modules/xxx -> /abs/path/.pnpm/xxx/node_modules/xxx
    case "$target" in
      /*) resolved="$target" ;;
      *)  resolved="$(dirname "$symlink")/$target" ;;
    esac
    # If target exists and is a directory, copy its content over the symlink
    if [ -d "$resolved" ]; then
      echo "  Dereferencing symlink: $(basename "$symlink")"
      rm -rf "$symlink"
      cp -r "$resolved/." "$symlink/"
    fi
  fi
done

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
