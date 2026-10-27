#!/usr/bin/env bash
# dshdesk — the single success criterion.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec 9>"/tmp/dshdesk-check.lock"
flock 9

echo '== generated bundle =='
node scripts/build-client.mjs --check

echo '== syntax =='
node --check index.js
node --check client.js
node --check lib/board.cjs
node --check scripts/check.mjs

echo '== unit tests =='
node --test test/*.test.mjs

echo '== packaging and wiring =='
node scripts/check.mjs
