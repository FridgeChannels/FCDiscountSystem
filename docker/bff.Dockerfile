FROM node:20-alpine

WORKDIR /workspace
COPY FCDiscountSystem/package*.json ./FCDiscountSystem/

WORKDIR /workspace/FCDiscountSystem
RUN npm ci --omit=dev

WORKDIR /workspace
COPY FCDiscountSystem ./FCDiscountSystem
COPY fc-platform ./fc-platform

WORKDIR /workspace/FCDiscountSystem
ENV FC_PLATFORM_ROOT=/workspace/fc-platform
ENV BFF_PORT=3001
EXPOSE 3001
CMD ["node", "server/index.js"]
