#!/bin/sh
set -e

UPLOAD_ROOT="/workspace/fc-platform/apps/web/public/uploaded-games"
mkdir -p "$UPLOAD_ROOT"

# Docker volume overlays public/uploaded-games; merge bundled games from the image (additive only).
if [ -d /seed/uploaded-games ] && [ -n "$(ls -A /seed/uploaded-games 2>/dev/null)" ]; then
	cp -rn /seed/uploaded-games/. "$UPLOAD_ROOT/"
fi

exec "$@"
