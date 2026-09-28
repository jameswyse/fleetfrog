#!/bin/sh
# Cloudflare Pages runs this from the repository root to build the site. Its build image has no
# Cargo, and pnpm runs `cargo metadata` on every install while the Rust agent is in the workspace,
# so the agent moves out of the checkout first, just as the hub image leaves it out of its context.
set -eu

# Cloudflare sets CF_PAGES during its builds. Anywhere else, moving the agent would disturb a
# real checkout.
if [ "${CF_PAGES:-}" != 1 ]; then
  echo "This script builds the site on Cloudflare Pages. Elsewhere, run: pnpm --filter @fleetfrog/site build" >&2
  exit 1
fi

mv apps/agent-rs "$(mktemp -d)"
pnpm install --frozen-lockfile --filter @fleetfrog/site
pnpm --filter @fleetfrog/site build
