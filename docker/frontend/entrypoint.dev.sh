#!/bin/sh
set -e
# Named volumes .next and node_modules may be root-owned on first run; ensure appuser can write (e.g. Turbopack lockfile).
chown -R appuser:appgroup /app/.next /app/node_modules 2>/dev/null || true
# Ensure dependencies in node_modules volume (volume is empty on first run)
su-exec appuser npm install
exec su-exec appuser "$@"
