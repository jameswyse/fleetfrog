# Local end-to-end tests

[Tester Army e2e](https://tester.army/e2e) runs Chromium against a real hub, two Rust agents, and temporary Git repositories. Most tests are deterministic browser flows. A few let a model drive the dashboard. Both kinds run separately from `pnpm verify` and CI.

## Set up

Complete the [development prerequisites](../README.md#develop). The full suite requires Linux and OpenSSL. From the repository root, install Chromium:

```sh
pnpm install
pnpm exec playwright install chromium
```

If Chromium reports missing system libraries, run `pnpm exec playwright install --with-deps chromium`.

Deterministic tests need no model credentials. To run model-driven tests, sign in through e2e's device flow:

```sh
pnpm exec e2e login openai --device
```

Open the printed URL, enter the code, and complete sign-in. Credentials are stored outside the repository. The model is configured in [e2e.config.ts](../e2e.config.ts).

## Run

```sh
pnpm test:e2e:deterministic           # Browser tests without model calls
pnpm test:e2e                        # Complete suite
pnpm test:e2e:agent                  # Model-driven tests
pnpm test:e2e --grep 'clone'         # Match test names
pnpm test:e2e tests/e2e/cleanup.e2e.ts
pnpm test:e2e --headed               # Watch Chromium; requires a display
pnpm test:e2e:serve                  # Explore the test dashboard manually
```

Each command builds the app and agent, starts an isolated fleet, and waits for repository discovery. No separately running app is needed. For `--serve`, open the printed dashboard URL and press Ctrl+C to stop.

Tests share a sandbox and run with one worker. Keep retries disabled. Use the wrapper commands above for fresh fixtures rather than repeating tests against an already changed sandbox.

Recorded agent actions can replay without model calls. Use `--no-cache` for fresh model decisions or `--strict-cache` to reject cache misses. Stale recordings can fall back to the model and consume subscription usage.

## Inspect results

Reports and failure traces are in `.e2e/runs/<sandbox-name>/`. Agent recordings are in `.e2e/cache/`. Both are ignored by Git.

Each run also prints its retained `/tmp/fleetfrog-e2e-*` directory. Inspect the repositories, agent data, hub database, and `hub.log`, `agent.log`, and `second-agent.log` there. Services stop after the run; sandbox files remain.

Agents use sandbox configuration, discovery roots, archives, and Linux trash storage. Git remotes and the OIDC provider run locally. T3 Code reads a fixture database, and agent self-updates are denied. Cleanup tests permanently delete only sandbox fixture files. Those tests reject other platforms because macOS trash is not isolated.

## Coverage and new tests

The suite covers project navigation and filters, Git actions and cloning, archive and trash, Activity and cancellation, preferences, fleet settings and pairing, users and accounts, password sign-in, local OIDC, and T3 Code discovery and busy-thread warnings. Assertions check real Git state, files, and persisted settings.

Live GitHub data, Tailscale, external identity providers, and release downloads and agent self-updates are outside this suite. Keep unit tests for algorithms, schemas, migrations, policy rules, and platform-specific behaviour.

Add `.e2e.ts` files under `tests/e2e/`. Tag names with `[deterministic]` or `[agent]`. Use explicit locators for stable browser flows and `agent.act` for model-driven goals. Check the resulting state, not just successful clicks.

Add isolated repositories in [tools/e2e/repositories.ts](../tools/e2e/repositories.ts). Give mutating flows separate fixtures, keep destructive paths inside the sandbox, and restore shared authentication and integration settings even after failures. The initial discovery count is derived from the fixture list.

List the current tests with `rg '^test[(]' tests/e2e`.
