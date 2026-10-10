# @fleetfrog/hub

## 0.8.0

No changes in this release.

## 0.7.0

### Minor Changes

- 168a425: Run the hub with `FLEETFROG_DEMO=1` to explore the dashboard with five simulated machines and their repositories. Fetching, pulling, cloning and the other actions change the simulated repositories, and the hub keeps nothing and doesn't accept agents while in demo mode.

### Patch Changes

- 11bf0a8: Refresh runtime dependencies, build tooling, Node.js and the Rust toolchain.

## 0.6.1

### Patch Changes

- 57cb148: Refresh runtime dependencies and build tooling, including fixes for vulnerable development dependencies.

## 0.6.0

### Minor Changes

- 2b0e49a: Pin repositories to the top of the Projects page, sort by name, recent commits or what needs attention, and group repositories into named groups or by owner, with fetch, pull, clone and rescan for a whole group.
- 597b8a7: Discard a checkout's uncommitted changes from its More menu, and choose to discard rather than stash changes when switching branches or removing a worktree. Discarded changes go to Cleanup → Trash, where they can be restored until the Trash is emptied. Discarding needs the cleanup tier. Group actions no longer offer Rescan.
- 3c18a69: Drag repositories onto Pinned, a group or back to their own section, and drag groups to reorder them. Choose a different folder for any repository when cloning a group. Pins, groups and other Projects layout changes now stay in step across tabs and devices instead of overwriting each other.

### Patch Changes

- 8f1765c: Run the hub on loopback under `pnpm dev`, and pass `FLEETFROG_*` settings through to development servers. Set `FLEETFROG_HOST=0.0.0.0` to pair agents on other machines.

## 0.5.3

### Patch Changes

- 1632469: Refuse a batch of more than 1000 runs, a request naming more than 1000 branches or stashes, a branch name that could pass as a Git option, a password longer than 256 characters, or an email longer than 254.
- 818f708: Cut text an agent reports to 4096 characters and lists to 5000 items, and keep at most 5000 checkouts for a machine, so one compromised agent can't fill the hub's database or every dashboard's memory.
- 1632469: Run the hub image's Node by its full path, with pnpm's writable folder off PATH.
- 1632469: Hash passwords at the scrypt cost OWASP recommends. Existing passwords still work and move to the new cost when they're next set.
- 1632469: Limit request bodies and WebSocket messages, so a flood of large ones can't take the hub's memory.
- 355f646: Add FLEETFROG_HOST, the address the dashboard and agent ports listen on, such as 127.0.0.1 behind a reverse proxy on the same host.
- 1632469: Ignore a sign-in provider's picture unless it's a web address, since every viewer's browser fetches it.
- 1632469: Send security headers with every dashboard response: a Content-Security-Policy that runs only the dashboard's own scripts, no framing by other sites, no referrer, and no content sniffing.

## 0.5.2

No changes in this release.

## 0.5.1

No changes in this release.

## 0.5.0

### Minor Changes

- d5c5bb8: Profile is now Profile & Settings, where you can choose a light, dark or system theme and blur email addresses and usernames from services such as GitHub while sharing your screen. Pointing at a blurred detail shows it. The hub saves these for each user, and one set for everyone while sign-in is off, so they follow you to other browsers. The account menu also offers the theme, and with sign-in off the settings are under Appearance.

## 0.4.0

### Minor Changes

- 5c76c49: Sign people in through Tailscale when the hub runs behind Tailscale Serve, as compose.tailscale.yaml sets up.
- dc7f86e: Run the hub on a tailnet with compose.tailscale.yaml, whose Tailscale sidecar serves it over HTTPS and gives pairing codes its tailnet address.

### Patch Changes

- 8df8a24: Stop within a few seconds while agents or dashboards are connected, instead of waiting until Docker kills the hub.

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- 85dd92d: Let people sign in with passwords and through an OpenID Connect provider at the same time, each turned on and off by itself, and give the provider sign-in button the icon from the provider website or an uploaded one.

## 0.2.0

### Minor Changes

- 25bb9d5: Add dashboard sign-in with email and password, admin and user roles, and FLEETFROG_AUTH_MODE=none to turn sign-in off.
- 45cdda0: Add dashboard sign-in through an OpenID Connect provider such as Authentik, with optional groups for admins and for who can sign in.
- e0311c6: Record who started each action and made each change.

## 0.1.1

### Patch Changes

- e26d3b3: Show which machines run an older agent than the hub in Settings › Fleet, and update them to the hub's version from there or from a machine's page.
- 2b33ebe: Offer to update an agent only when its machine's owner allows updates, and list agent updates among what each machine allows.

## 0.1.0

### Minor Changes

- 17c1b9f: Read T3 Code on each machine: show its project names and icons for repositories, and add Settings › Integrations › T3 Code with switches, what each machine's agent found, and a warning when T3 Code's database schema differs from the one FleetFrog was built for.
- 4674765: Publish the hub image to GitHub's container registry as ghcr.io/jameswyse/fleetfrog-hub.

### Patch Changes

- 191f88c: Stop the History page from disconnecting the dashboard, and repair Archive folder changes recorded before the folder was set per machine.
- 6e10590: Build the hub's Docker image on pnpm's base image, with the pnpm and Node.js versions pinned in devEngines.
