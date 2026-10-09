# fleetfrog.dev

The FleetFrog website: one static page, and a page for addresses that don't exist. Vite builds it with Tailwind, and a little TypeScript draws the pond behind the hero and runs the copy buttons.

```sh
pnpm --filter @fleetfrog/site dev
pnpm --filter @fleetfrog/site build
# Serves the build as Cloudflare does, with the headers in public/_headers and the 404 page.
pnpm --filter @fleetfrog/site preview
```

The download links point at the latest GitHub release, so they never need updating.

The screenshot below the hero is `src/images/screenshot.webp`, with `screenshot@2x.webp` for high-density screens. The social preview image, `public/og.png`, shows the hero's headline above the same screenshot. `pnpm screenshots` at the repository root captures all three from a demo hub, along with the README's screenshots.

## Deploying

Cloudflare Workers serves the site as static assets, and Workers Builds builds it from GitHub. Pushes to `main` deploy fleetfrog.dev and www.fleetfrog.dev. A push to any other branch that changes the site builds a preview at a subdomain, such as `my-branch.fleetfrog.dev`, and Cloudflare's GitHub app comments its address on the pull request. [`wrangler.jsonc`](wrangler.jsonc) configures the Worker, including its custom domains. The Worker's build settings are:

| Setting           | Value                                             |
| ----------------- | ------------------------------------------------- |
| Worker name       | `fleetfrog-website`, the name in `wrangler.jsonc` |
| Production branch | `main`                                            |
| Preview builds    | On                                                |
| Root directory    | `apps/site`                                       |
| Build command     | `sh scripts/cloudflareBuild.sh`                   |
| Deploy command    | `npx wrangler deploy`, the default                |
| Preview command   | `npx wrangler preview`, the default               |
| Build watch paths | Include `apps/site/*`                             |
| Build variable    | `SKIP_DEPENDENCY_INSTALL` set to `1`              |

Cloudflare's own install step would fail, because pnpm needs Cargo while the Rust agent is in the workspace and Cloudflare's build image doesn't have it. `SKIP_DEPENDENCY_INSTALL` turns that step off, and [`scripts/cloudflareBuild.sh`](scripts/cloudflareBuild.sh) moves the agent out of the checkout, installs only the site's dependencies and builds it. pnpm switches itself to the version in the root `package.json` and downloads the Node.js version pinned there. The deploy and preview commands then run the Wrangler version in this package's `package.json`.

`public/_headers` sets the page's security headers and lets browsers cache the built assets for good. Its content security policy allows nothing from other origins, so anything added from another origin, such as Cloudflare Web Analytics, needs adding there too.
