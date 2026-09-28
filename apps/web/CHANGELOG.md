# @fleetfrog/web

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
