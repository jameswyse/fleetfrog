# Build from the repository root: docker build -f apps/hub/Dockerfile .
FROM node:26.10.0-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@12.6.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fleetfrog/web build && pnpm --filter @fleetfrog/hub build
RUN pnpm --filter @fleetfrog/hub deploy --prod --legacy /deploy

FROM node:26.10.0-slim
WORKDIR /app
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /repo/apps/hub/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production \
    FLEETFROG_DATA_DIR=/data \
    FLEETFROG_WEB_ROOT=/app/web
USER node
VOLUME /data
EXPOSE 7420 7421
CMD ["node", "dist/main.mjs"]
