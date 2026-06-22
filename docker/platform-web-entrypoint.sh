#!/bin/sh
set -e

UPLOAD_ROOT="/workspace/fc-platform/apps/web/public/uploaded-games"
mkdir -p "$UPLOAD_ROOT"

# Docker volume overlays public/uploaded-games. Overwrite repo-bundled runtime files on each
# container start so image fixes (e.g. game.js) reach production; admin-only uploads are kept.
if [ -d /seed/uploaded-games ] && [ -n "$(ls -A /seed/uploaded-games 2>/dev/null)" ]; then
	cp -rf /seed/uploaded-games/. "$UPLOAD_ROOT/"
fi

exec "$@"
