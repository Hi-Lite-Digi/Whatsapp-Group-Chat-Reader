#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_DIR"

if [ -n "$(git status --porcelain)" ]; then
  printf 'Refusing to package a dirty working tree. Commit the reviewed release first.\n' >&2
  exit 1
fi

RELEASE_ID=$(git rev-parse HEAD)
ARTIFACT="${TMPDIR:-/tmp}/whatsapp-listener-$RELEASE_ID.tgz"
git archive --format=tar.gz --output "$ARTIFACT" HEAD
CHECKSUM=$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')

printf 'RELEASE_ID=%s\n' "$RELEASE_ID"
printf 'ARTIFACT=%s\n' "$ARTIFACT"
printf 'SHA256=%s\n' "$CHECKSUM"

