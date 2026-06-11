FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

WORKDIR /workspace/fc-platform
COPY fc-platform/pnpm-lock.yaml ./pnpm-lock.yaml
COPY fc-platform/package.json ./package.json
COPY fc-platform/turbo.json ./turbo.json
COPY fc-platform/tsconfig.base.json ./tsconfig.base.json
COPY fc-platform/tsconfig.json ./tsconfig.json
COPY fc-platform/apps ./apps
COPY fc-platform/packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fc/web build

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

WORKDIR /workspace/fc-platform
COPY --from=build /workspace/fc-platform /workspace/fc-platform

WORKDIR /workspace/fc-platform/apps/web
ENV NODE_ENV=production
ENV PORT=8789
RUN mkdir -p public/uploaded-games

EXPOSE 8789
VOLUME ["/workspace/fc-platform/apps/web/public/uploaded-games"]

HEALTHCHECK --interval=15s --timeout=5s --retries=8 \
  CMD wget -q -O /dev/null http://127.0.0.1:8789/admin/game-library || exit 1

CMD ["pnpm", "start"]
