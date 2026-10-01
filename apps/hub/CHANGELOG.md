# @fleetfrog/hub

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
