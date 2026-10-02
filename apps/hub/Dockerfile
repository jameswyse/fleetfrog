# Build from the repository root: docker build -f apps/hub/Dockerfile .
# The image's pnpm switches to the version in devEngines.packageManager, and pnpm install
# fetches the Node.js in devEngines.runtime, so only the pnpm major is pinned here.
FROM ghcr.io/pnpm/pnpm:12 AS base

FROM base AS build
WORKDIR /repo
# Fetch the pinned pnpm in its own layer, so only changes to the root manifest repeat it.
COPY package.json ./
RUN pnpm --version
COPY . .
# The build context keeps its owner's file modes; a strict umask would leave the dashboard
# unreadable by the unprivileged runtime user.
RUN chmod -R u=rwX,go=rX .
# .dockerignore leaves out the projects the image doesn't build, and a frozen install of the whole
# workspace fails on their missing directories, so install only the hub and its dashboard.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @fleetfrog/hub... --filter @fleetfrog/web...
RUN pnpm --filter @fleetfrog/web build && pnpm --filter @fleetfrog/hub build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @fleetfrog/hub deploy --prod --legacy /deploy
# The runtime stage needs Node.js but not pnpm, so it takes the binary pnpm installed.
RUN cp "$(readlink -f node_modules/.bin/node)" /deploy/node

FROM base
WORKDIR /app
# Match the uid and gid of the official Node.js image's user, which owns existing data volumes.
RUN groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --create-home --shell /usr/sbin/nologin node \
    && mkdir /data \
    && chown node:node /data
COPY --from=build /deploy/node /usr/local/bin/node
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /repo/apps/hub/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
# The base image puts pnpm's world-writable bin folder first on PATH. The hub runs its own Node
# by its full path and leaves that folder off PATH, so nothing written there is ever run.
ENV NODE_ENV=production \
    FLEETFROG_DATA_DIR=/data \
    FLEETFROG_WEB_ROOT=/app/web \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER node
VOLUME /data
EXPOSE 7420 7421
CMD ["/usr/local/bin/node", "dist/main.mjs"]
