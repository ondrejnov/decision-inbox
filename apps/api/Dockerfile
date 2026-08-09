FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
RUN npm ci --workspace @decision-inbox/api --workspace @decision-inbox/contracts --include-workspace-root

COPY apps/api/src ./apps/api/src
COPY packages/contracts/src ./packages/contracts/src
RUN npm run build --workspace @decision-inbox/contracts \
    && npm run build --workspace @decision-inbox/api

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    SQLITE_PATH=/data/decision-inbox.sqlite
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev --workspace @decision-inbox/api --workspace @decision-inbox/contracts --include-workspace-root \
    && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist

RUN mkdir /data && chown node:node /data

VOLUME ["/data"]
USER node
EXPOSE 8787
CMD ["node", "apps/api/dist/index.js"]
