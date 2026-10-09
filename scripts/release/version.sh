#!/bin/sh
set -eu

pnpm changeset version
pnpm exec playwright install --with-deps --only-shell chromium
pnpm screenshots
