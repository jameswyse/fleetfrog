#!/bin/sh
# Workers Builds runs this from apps/site to build the site. Its build image has no Cargo, and pnpm
# runs `cargo metadata` on every install while the Rust agent is in the workspace, so the agent
# moves out of the checkout first, just as the hub image leaves it out of its build context.
set -eu

# Workers Builds sets WORKERS_CI. Anywhere else, moving the agent would disturb a real checkout.
if [ "${WORKERS_CI:-}" != 1 ]; then
  echo "This script builds the site on Cloudflare. Elsewhere, run: pnpm --filter @fleetfrog/site build" >&2
  exit 1
fi

cd "$(dirname "$0")/../../.."
mv apps/agent-rs "$(mktemp -d)"
pnpm install --frozen-lockfile --filter @fleetfrog/site
pnpm --filter @fleetfrog/site build
