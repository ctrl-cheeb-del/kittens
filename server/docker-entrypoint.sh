#!/bin/sh
# Fly mounts volumes root-owned, so a fresh /data is unwritable by the service
# account. Take ownership, then drop privileges before exec'ing the server —
# the fingerprinting process itself never needs root.
set -e

CACHE="${KITTENS_ACME_CACHE:-/data/acme}"

if [ -n "$CACHE" ]; then
    mkdir -p "$CACHE"
    chown -R kittens:kittens "$CACHE" 2>/dev/null || true
fi

exec setpriv --reuid=kittens --regid=kittens --init-groups \
    /usr/local/bin/kittens "$@"
