# @fleetfrog/web

## 0.5.2

### Patch Changes

- a9f6533: Fix the side panel's list of changed files, whose change badges stretched across the panel and hid the file names.

## 0.5.1

### Patch Changes

- 123eada: Show repository owners unblurred when blurring emails and usernames is on.
- 123eada: Rename the "T3 Code at work" section in the Projects overview to "T3 Code Status".

## 0.5.0

### Minor Changes

- d5c5bb8: Profile is now Profile & Settings, where you can choose a light, dark or system theme and blur email addresses and usernames from services such as GitHub while sharing your screen. Pointing at a blurred detail shows it. The hub saves these for each user, and one set for everyone while sign-in is off, so they follow you to other browsers. The account menu also offers the theme, and with sign-in off the settings are under Appearance.

## 0.4.0

### Minor Changes

- 5c76c49: Add Tailscale as a way of signing in, with a one-click Continue button on the sign-in page and a switch under Settings › Authentication.

### Patch Changes

- 680bf44: Show a lost hub connection in the top bar's status, with a short-lived bubble saying how old the page is, in place of the banner that pushed the page down. The account menu no longer disappears while the hub is unreachable.

## 0.3.1

### Patch Changes

- e61d702: Open Projects after signing in, rather than the page you signed out from.

## 0.3.0

### Minor Changes

- 85dd92d: Give each way of signing in its own switch, move OpenID Connect to its own settings page, and show the provider icon on the sign-in button.

## 0.2.0

### Minor Changes

- 45cdda0: Add sign-in provider settings, with a test sign-in that turns the provider on.
- e0311c6: Show who started each action and made each change in Activity.
- 25bb9d5: Add a sign-in page, a profile page with pictures and passwords, and Users and Authentication settings for admins.

## 0.1.1

### Patch Changes

- e26d3b3: Show which machines run an older agent than the hub in Settings › Fleet, and update them to the hub's version from there or from a machine's page.
- 2b33ebe: Offer to update an agent only when its machine's owner allows updates, and list agent updates among what each machine allows.

## 0.1.0

### Minor Changes

- 9c9a6fe: Show where T3 Code's agents are working: in grid cells, a "T3 Code at work" list in the Fleet panel and a T3 Code section for each checkout. Pull, switching branch, stashing, archiving, trashing and removing a worktree warn or ask first while an agent works there, and say when a T3 Code project opens a folder that's about to move. Worktrees name the T3 Code thread they were made for, and repositories shown under a T3 Code name show their host and path beneath it in the grid.
- 17c1b9f: Read T3 Code on each machine: show its project names and icons for repositories, and add Settings › Integrations › T3 Code with switches, what each machine's agent found, and a warning when T3 Code's database schema differs from the one FleetFrog was built for.
- 8041d44: Show T3 Code's version, whether its server is running and its coding agents' versions, updates and sign-in state for each machine, and line up the grid's project and host icons and names.

### Patch Changes

- 8dd4e47: Move Fetch all, Pull all and Rescan all into a Fleet actions menu, and stretch the Projects grid to fill the page up to 1800px.
- 61b4809: List Integrations above Fleet in the Settings menu.
- acd06d0: Stop the Pair a machine page saying a machine is paired when it's opened directly.
- ef7bba6: Show the command that installs the agent on the Pair a machine page.
- 56b2e34: Show T3 Code's icon beside it in Settings.
- 7ba6045: Centre repository icons in the Projects grid, with or without a T3 Code name.
- 43119c2: Show when a machine runs the Rust agent in its system details.
