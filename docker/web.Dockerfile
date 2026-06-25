FROM node:20-alpine AS build

WORKDIR /workspace
COPY FCDiscountSystem/package*.json ./FCDiscountSystem/

WORKDIR /workspace/FCDiscountSystem
RUN npm ci

WORKDIR /workspace
COPY FCDiscountSystem ./FCDiscountSystem
COPY fc-platform ./fc-platform

WORKDIR /workspace/FCDiscountSystem
ENV FC_PLATFORM_ROOT=/workspace/fc-platform
ARG VITE_API_BASE=/api/fc
ARG VITE_RUNTIME_SHELL_BASE_URL=http://localhost:8080
ARG VITE_MANIFEST_PUBLIC_KEY_PEM=
ARG VITE_MANIFEST_REQUIRE_SIGNATURE=false
ARG VITE_DEMO_FORCE_RENEW_ENABLED=false
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_RUNTIME_SHELL_BASE_URL=${VITE_RUNTIME_SHELL_BASE_URL}
ENV VITE_MANIFEST_PUBLIC_KEY_PEM=${VITE_MANIFEST_PUBLIC_KEY_PEM}
ENV VITE_MANIFEST_REQUIRE_SIGNATURE=${VITE_MANIFEST_REQUIRE_SIGNATURE}
ENV VITE_DEMO_FORCE_RENEW_ENABLED=${VITE_DEMO_FORCE_RENEW_ENABLED}
RUN npm run build

FROM nginx:1.27-alpine
COPY FCDiscountSystem/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/FCDiscountSystem/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=2s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
