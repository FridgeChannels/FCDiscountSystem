FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

WORKDIR /workspace/fc-platform
COPY fc-platform/pnpm-lock.yaml ./pnpm-lock.yaml
COPY fc-platform/package.json ./package.json
COPY fc-platform/turbo.json ./turbo.json
COPY fc-platform/apps ./apps
COPY fc-platform/packages ./packages
COPY fc-platform/tsconfig*.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fc/engine build

WORKDIR /workspace/fc-platform/apps/engine
ENV ENGINE_PORT=8787
EXPOSE 8787
CMD ["pnpm", "start"]
