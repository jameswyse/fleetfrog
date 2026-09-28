# fleetfrog.dev

The FleetFrog website: one static page, and a page for addresses that don't exist. Vite builds it with Tailwind, and a little TypeScript draws the pond behind the hero and runs the copy buttons.

```sh
pnpm --filter @fleetfrog/site dev
pnpm --filter @fleetfrog/site build
```

The page shows the version in this package's `package.json`. Every package shares one version, so it matches the hub and agent released from the same commit. The download links point at the latest GitHub release, so they never need updating.

## Deploying

Cloudflare Pages builds the site from GitHub. Pushes to `main` update fleetfrog.dev, and each pull request that changes the site gets a preview, which the Cloudflare app links in a comment. The project uses these settings:

| Setting                | Value                                     |
| ---------------------- | ----------------------------------------- |
| Production branch      | `main`                                    |
| Framework preset       | None                                      |
| Build command          | `sh apps/site/scripts/cloudflareBuild.sh` |
| Build output directory | `apps/site/dist`                          |
| Root directory         | The repository root                       |
| Build watch paths      | Include `apps/site/*`                     |
| Environment variable   | `SKIP_DEPENDENCY_INSTALL` set to `1`      |

Cloudflare's own install step would fail, because pnpm needs Cargo while the Rust agent is in the workspace and Cloudflare's build image doesn't have it. `SKIP_DEPENDENCY_INSTALL` turns that step off, and [`scripts/cloudflareBuild.sh`](scripts/cloudflareBuild.sh) moves the agent out of the checkout, installs only the site's dependencies and builds it. pnpm switches itself to the version in the root `package.json` and downloads the Node.js version pinned there.

`public/_headers` sets the page's security headers and lets browsers cache the built assets for good. Its content security policy allows nothing from other origins, so anything added from another origin, such as Cloudflare Web Analytics, needs adding there too.
