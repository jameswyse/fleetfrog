#!/usr/bin/env bash
# Creates repositories in awkward states under $1, for comparing what the two agents read.
set -euo pipefail

root="$1"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.com
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.com
export GIT_AUTHOR_DATE="2026-09-27T14:05:00+10:00" GIT_COMMITTER_DATE="2026-09-27T14:05:00+10:00"

mkdir -p "$root"
cd "$root"

commit() { git -C "$1" commit -q --allow-empty -m "$2"; }

# A clone with an upstream it is ahead of and behind, stashes, every kind of change, trash refs and
# linked worktrees in each state.
git init -q -b main shop
cd shop
git remote add origin git@github.com:Acme/Shop.git
echo one > tracked.txt && echo old > rename-me.txt && echo "ünïcödé" > "file with spaces.txt"
git add . && commit . "First"
first=$(git rev-parse HEAD)
commit . "Second"
commit . "Third on origin"
git update-ref refs/remotes/origin/main HEAD
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
git reset -q --hard "$first"
commit . "Local only"
git branch -q --set-upstream-to=origin/main main
git branch -q feature "$first"
git branch -q gone "$first"
git config branch.gone.remote origin && git config branch.gone.merge refs/heads/gone
git branch -q merged "$first"
echo stash1 >> tracked.txt && git stash -q
echo stash2 >> tracked.txt && git stash push -q -m "second stash"
echo staged >> tracked.txt && git add tracked.txt
echo unstaged >> tracked.txt
git mv rename-me.txt renamed.txt
echo new > untracked.txt
mkdir -p node_modules/x && echo x > node_modules/x/index.js && echo "node_modules" > .gitignore
git update-ref refs/fleetfrog/deleted/1790000000000/old-feature "$first"
git update-ref refs/fleetfrog/deleted/1790000000001/feature/nested "$first"
git update-ref refs/fleetfrog/stashes/1790000000002/0 "$(git rev-parse stash@{0})"
touch .git/FETCH_HEAD
git worktree add -q ../shop-feature feature
git worktree add -q --detach ../shop-detached "$first"
git worktree add -q ../shop-missing -b missing-branch "$first"
rm -rf ../shop-missing
git worktree add -q nested-tree -b nested "$first"
git worktree lock --reason "on a USB drive" ../shop-feature
cd ..

# A merge stopped by a conflict.
git init -q -b main conflicted
cd conflicted
echo base > file.txt && git add . && commit . "Base"
git checkout -q -b other && echo other > file.txt && git commit -qam "Other"
git checkout -q main && echo mine > file.txt && git commit -qam "Mine"
git merge -q other >/dev/null 2>&1 || true
cd ..

# Detached, unborn, and one with an HTTPS origin carrying credentials.
git init -q -b main detached && commit detached "One" && commit detached "Two"
git -C detached checkout -q --detach HEAD~1
git init -q -b trunk unborn && git -C unborn remote add origin https://user:secret@gitlab.com/group/sub/Unborn.git
git init -q -b main "with spaces" && commit "with spaces" "Spaced"

# Folders discovery skips: hidden, dependencies, too deep and linked.
mkdir -p .hidden deps/node_modules a/b/c/d/e/f
git init -q .hidden/repo && commit .hidden/repo "Hidden"
git init -q deps/node_modules/repo && commit deps/node_modules/repo "Dependency"
git init -q a/b/c/d/e/f/deep && commit a/b/c/d/e/f/deep "Deep"
git init -q a/b/c/d/e/shallow && commit a/b/c/d/e/shallow "Shallow enough"
ln -s "$root/detached" linked
