FROM node:20-alpine AS build

WORKDIR /workspace/fc-platform
COPY fc-platform/package-lock.json ./package-lock.json
COPY fc-platform/package.json ./package.json
COPY fc-platform/turbo.json ./turbo.json
COPY fc-platform/tsconfig.base.json ./tsconfig.base.json
COPY fc-platform/tsconfig.json ./tsconfig.json
COPY fc-platform/apps ./apps
COPY fc-platform/packages ./packages

RUN npm ci
RUN npm run build -w @fc/web

FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /workspace/fc-platform
COPY --from=build /workspace/fc-platform /workspace/fc-platform

WORKDIR /workspace/fc-platform/apps/web
ENV NODE_ENV=production
ENV PORT=8789
RUN mkdir -p public/uploaded-games \
  && cp -a public/uploaded-games /seed/uploaded-games

COPY FCDiscountSystem/docker/platform-web-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8789
VOLUME ["/workspace/fc-platform/apps/web/public/uploaded-games"]

HEALTHCHECK --interval=15s --timeout=5s --retries=8 \
  CMD wget -q -O /dev/null http://127.0.0.1:8789/admin/game-library || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
