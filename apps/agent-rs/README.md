# FleetFrog agent in Rust

This is the FleetFrog agent as a single native binary. It does everything the TypeScript agent in `apps/agent-ts` does and speaks the same protocol, so the hub treats the two alike. It needs no Node: on a development machine it uses about 7 MB of memory and one thread, where the TypeScript agent uses about 125 MB and eleven threads.

Both agents read and write the same files on a machine: the pairing in `~/.config/fleetfrog`, the policy, the audit log, the trash and the archive records. Both also install the same service, so installing one replaces the other and keeps its pairing.

An agent run with `FLEETFROG_INSTANCE` set, such as `dev`, is a separate instance. It keeps its pairing and policy in `~/.config/fleetfrog-dev`, writes its own action log and installs its own service, so it runs beside the default agent. It still shares the machine's checkouts, archive records and trash. The [main README](../../README.md#develop) explains how to set one up.

## Build and install

Each [release](https://github.com/jameswyse/fleetfrog/releases) includes this agent for Linux and macOS, and the [main README](../../README.md#add-a-machine) explains how to install it. Build it yourself to work on it.

Building needs a Rust toolchain (`rustup` installs one) as well as pnpm. pnpm resolves and vendors the crates, so run `pnpm install` before building:

```sh
pnpm install
pnpm --filter @fleetfrog/agent-rs build
apps/agent-rs/dist/fleetfrog pair ffp1_…
apps/agent-rs/dist/fleetfrog service install
```

A machine already paired with the TypeScript agent needs only the build and `service install`. The commands match the TypeScript agent's, and `fleetfrog status` shows `(Rust)` after the version.

## Develop

Add a crate with `pnpm add crate:<name>` in this folder. pnpm writes `Cargo.toml` and `Cargo.lock`, applies the workspace's minimum release age, and links the crates from its store into `.pnpm/`, which `.cargo/config.toml` points Cargo at.

The package scripts run through Cargo, so `pnpm verify` formats, lints, checks, builds and tests this crate with the rest of the workspace. Its `test:unit` script also runs `scripts/agentParity/compare.mjs`, which builds Git repositories in awkward states and checks that both agents read them identically: discovery, every status field, inspections and their fingerprints, T3 Code and, where `gh` is signed in, GitHub. The hidden `__scan`, `__inspect`, `__t3code` and `__github` commands print this agent's side of that comparison.

Change both agents together when the protocol or an agent's behaviour changes, and extend the fixtures when a new state matters.

## Differences from the TypeScript agent

- A release build of this agent updates itself to its hub's version, with `fleetfrog update` or when the hub asks. The TypeScript agent always runs from source, so it never updates itself, and its `fleetfrog update` says to update it with Git.
- Git remotes with non-ASCII host names are not recognised, because the URL parser is built without Unicode host support to keep the binary small. Such a checkout falls back to its root commit for its identity and has no clone URL.
- T3 Code's default monogram colour skips Unicode NFKC normalisation of the project title, which only changes the colour for titles with compatibility characters such as full-width letters.
- The icons in a `ProjectIcons` report are in project order rather than the order their files were read.
