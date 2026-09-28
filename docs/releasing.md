# Releasing

FleetFrog is in beta, so versions stay below 1.0. Every package shares one version, which [changesets](https://github.com/changesets/changesets) bumps.

Agents update to their hub's version and never past it, so every release ships the hub image and the agent binaries together, even when only one of them changed. `fleetfrog update` and the dashboard's update buttons download the agent from the GitHub release named after the hub's version.

To show what changed, `fleetfrog update` reads `apps/agent-rs/CHANGELOG.md` at the hub's version tag from GitHub and lists each `## <version>` section after the installed version. The dashboard links to the same file. Updates still work if the changelog moves or changes format, but `fleetfrog update` can no longer list the changes, and a move also breaks the dashboard's link.

## Versions

Describe each change people will notice in a changeset, naming the packages it changes:

```sh
pnpm changeset --patch @fleetfrog/web -m 'Centre rows in the Projects grid.'
```

Choose `minor` for a change that breaks something, such as a protocol change that needs the hub updated before the agents or a change to how the hub or agent stores data. Choose `patch` for everything else. Changesets raises every package to the highest bump among the pending changesets.

## Releasing a version

The [release workflow](../.github/workflows/release.yml) runs on every push to `main`. While changesets are pending, it keeps a pull request named "chore(release): version packages" up to date. That pull request runs `pnpm changeset version`, which bumps every package and writes the changes into each package's `CHANGELOG.md`.

Merging it releases the version. The workflow then:

1. Builds the agent for Linux on x86-64 and ARM, linked statically against musl so it runs on any distribution, and for macOS on Apple silicon. It sets `FLEETFROG_RELEASE`, which marks the build as one that can update itself.
2. Builds the hub image for `linux/amd64` and `linux/arm64`.
3. Once every build passes, tags the image `ghcr.io/jameswyse/fleetfrog-hub` with the version, such as `0.1.3`, its minor version, such as `0.1`, and `latest`.
4. Creates the GitHub release and its `v0.1.3` tag, with the three agent binaries, `install.sh` and `SHA256SUMS`. Its notes merge the version's sections from every changelog.

Releases are never marked as pre-releases, because `releases/latest` skips them and the install script downloads from there.

The website, [fleetfrog.dev](https://fleetfrog.dev), shows the version from `apps/site/package.json`, so Cloudflare Pages deploys it again when the Version packages pull request merges. Its download links point at `releases/latest`, which serves the new binaries once the workflow creates the release. [`apps/site`](../apps/site/README.md) explains how it's deployed.

If a build fails, push a fix to `main` without a changeset. That push releases the same version, since it has no GitHub release yet. Rerunning the failed jobs also works when the failure was temporary.

## Checking a release

The workflow attests where each binary and the image came from. Check them with the GitHub CLI:

```sh
gh attestation verify fleetfrog-linux-x86_64 --repo jameswyse/fleetfrog
gh attestation verify oci://ghcr.io/jameswyse/fleetfrog-hub:0.1.3 --repo jameswyse/fleetfrog
```

## Setting up the release app

A pull request opened with the workflow's own token doesn't start other workflows, so the Version packages pull request would get no CI. The workflow opens it as a GitHub App instead. To set one up:

1. [Create a GitHub App](https://github.com/settings/apps/new) owned by your account. Give it any name and homepage URL, clear **Webhook › Active**, and grant these repository permissions: **Contents** read and write, **Pull requests** read and write. Allow it to be installed only on this account.
2. On the app's page, note its **Client ID** and generate a private key.
3. Install the app on the `fleetfrog` repository only.
4. In the repository's **Settings › Secrets and variables › Actions**, add the variable `RELEASE_APP_CLIENT_ID` with the client ID, and the secret `RELEASE_APP_PRIVATE_KEY` with the contents of the private key file.

The first push of an image creates the `fleetfrog-hub` package as private. Make it public once, under the package's **Package settings**.
