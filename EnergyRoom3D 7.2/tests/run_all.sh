#!/usr/bin/env bash
# Runs every test suite. Needs Node 18+; the browser suite additionally needs Playwright + Chromium.
set -e
cd "$(dirname "$0")/.."
for f in js/*.js js/*/*.js; do node --check "$f"; done && echo "syntax OK (all JS files)"
node tests/engine_stage1.test.js
node tests/integration_stage1.test.js
node tests/i18n.test.js
node tests/grid.test.js
node tests/electrical.test.js
node tests/integration_stage2.test.js
node tests/models.test.js
node tests/browser_priority.test.js
node tests/browser_installation.test.js
