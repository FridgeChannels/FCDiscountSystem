FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /workspace/fc-platform
COPY fc-platform/package-lock.json ./package-lock.json
COPY fc-platform/package.json ./package.json
COPY fc-platform/turbo.json ./turbo.json
COPY fc-platform/scripts ./scripts
COPY fc-platform/apps ./apps
COPY fc-platform/packages ./packages
COPY fc-platform/tsconfig*.json ./

RUN npm ci
RUN npm run build -w @fc/shared-types \
	&& npm run build -w @fc/db \
	&& npm run build -w @fc/game-templates \
	&& npm run build -w @fc/engine \
	&& node scripts/prepare-prod-packages.mjs

WORKDIR /workspace/fc-platform/apps/engine
ENV ENGINE_PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
