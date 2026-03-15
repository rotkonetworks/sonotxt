#!/bin/sh
# Download Live2D Cubism SDK sample models for avatar rendering
# These models are provided by Live2D Inc. under the Free Material License.
# Attribution required: "Uses sample data owned and copyrighted by Live2D Inc."
#
# Source: https://github.com/Live2D/CubismWebSamples

set -e

DEST="$(dirname "$0")/../public/live2d"
REPO_URL="https://github.com/Live2D/CubismWebSamples"
BRANCH="develop"
MODELS="Haru Hiyori Mao Mark Natori Rice Wanko"

mkdir -p "$DEST"

echo "Downloading Live2D sample models..."

# Clone sparse checkout of just the Resources directory
TMP=$(mktemp -d)
cd "$TMP"
git init -q
git remote add origin "$REPO_URL"
git sparse-checkout init
git sparse-checkout set "Samples/Resources"
git fetch --depth 1 origin "$BRANCH" -q
git checkout FETCH_HEAD -q

for model in $MODELS; do
  lower=$(echo "$model" | tr 'A-Z' 'a-z')
  src="Samples/Resources/$model"
  if [ -d "$src" ]; then
    echo "  $model -> $DEST/$lower/"
    rm -rf "$DEST/$lower"
    cp -r "$src" "$DEST/$lower"
    # Rename model3.json to lowercase
    if [ -f "$DEST/$lower/$model.model3.json" ]; then
      mv "$DEST/$lower/$model.model3.json" "$DEST/$lower/$lower.model3.json"
      # Update internal references in model3.json to match
      sed -i "s|$model|$lower|g" "$DEST/$lower/$lower.model3.json"
    fi
  else
    echo "  WARNING: $model not found in repo"
  fi
done

# Clean up
rm -rf "$TMP"

# Create attribution file
cat > "$DEST/ATTRIBUTION.md" << 'EOF'
# Live2D Sample Models

These models are provided by Live2D Inc. under the
[Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html).

This content uses sample data owned and copyrighted by Live2D Inc.

Models: Haru, Hiyori, Mao, Mark, Natori, Rice, Wanko
Source: https://github.com/Live2D/CubismWebSamples
EOF

echo "Done! Models saved to $DEST/"
echo "Note: You must also load the Cubism Core SDK from:"
echo "  https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
