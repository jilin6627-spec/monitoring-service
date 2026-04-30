# Dockerfile for monitoring-service — PROXYIP export node for edgetunnel
# Architecture: edgetunnel (VLESS binary) → Cloudflare TCP Tunnel → Xray (ARGO_PORT=8001) → BestIP Exit

# Stage 1: Download and prepare binaries
FROM alpine:latest AS downloader
WORKDIR /downloads
RUN apk add --no-cache curl unzip

# Download Xray-core (as backend-engine)
# Xray provides standalone binary in release ZIP
RUN curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip -o xray.zip && \
    mv xray /downloads/backend-engine

# Download cloudflared (as metrics-tunnel)
RUN curl -L -o metrics-tunnel https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod +x metrics-tunnel

# Stage 2: Build final image
FROM node:18-alpine
WORKDIR /app

# System dependencies
RUN apk add --no-cache \
    curl \
    ca-certificates \
    unzip \
    bash \
    tzdata \
    procps \
    gcompat

# Copy pre-downloaded binaries from downloader stage
COPY --from=downloader /downloads/backend-engine /usr/local/bin/backend-engine
COPY --from=downloader /downloads/metrics-tunnel /usr/local/bin/metrics-tunnel

RUN chmod +x /usr/local/bin/backend-engine /usr/local/bin/metrics-tunnel

# App dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# No aliasing needed — binary names already match code expectations

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]
