#!/bin/bash
# Jekyll blog start script
# Usage: ./run.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "🚀 Starting Jekyll dev server..."
echo "📂 Project: $(basename "$SCRIPT_DIR")"
echo ""

echo "🧹 Clearing incremental build cache..."
rm -rf .jekyll-cache .jekyll-metadata _site
echo ""

bundle exec jekyll serve \
    --livereload \
    --incremental \
    --force_polling \
    --trace
