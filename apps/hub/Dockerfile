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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
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
ENV NODE_ENV=production \
    FLEETFROG_DATA_DIR=/data \
    FLEETFROG_WEB_ROOT=/app/web
USER node
VOLUME /data
EXPOSE 7420 7421
CMD ["node", "dist/main.mjs"]
