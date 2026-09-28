# @fleetfrog/hub

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
