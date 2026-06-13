FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /workspace/fc-platform
COPY fc-platform/package-lock.json ./package-lock.json
COPY fc-platform/package.json ./package.json
COPY fc-platform/turbo.json ./turbo.json
COPY fc-platform/apps ./apps
COPY fc-platform/packages ./packages
COPY fc-platform/tsconfig*.json ./

RUN npm ci
RUN npm run build -w @fc/engine

WORKDIR /workspace/fc-platform/apps/engine
ENV ENGINE_PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
