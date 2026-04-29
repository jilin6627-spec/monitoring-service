# Dockerfile for Distributed Monitoring Node
# Focus: Performance optimized telemetry with pre-packaged binaries

# Stage 1: Binary Preparation
FROM golang:alpine AS builder
WORKDIR /app
RUN apk add --no-cache git curl unzip
# Build minimal data channel tool (Gost)
RUN git clone https://github.com/ginuerzh/gost.git && \
    cd gost/cmd/gost && \
    go build -ldflags "-s -w" -o /app/resource-agent
# Download Cloudflared (Metrics Tunnel)
RUN curl -L -o /app/metrics-tunnel https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
# Download Xray (Backend Engine)
RUN curl -L -o /app/xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip -o /app/xray.zip -d /app/xray_temp && \
    mv /app/xray_temp/xray /app/backend-engine

# Stage 2: Final Image
FROM node:18-alpine
WORKDIR /app

# System dependencies
RUN apk add --no-cache curl ca-certificates unzip bash tzdata procps gcompat

# Copy pre-downloaded binaries from builder
COPY --from=builder /app/resource-agent /usr/local/bin/resource-agent
COPY --from=builder /app/metrics-tunnel /usr/local/bin/metrics-tunnel
COPY --from=builder /app/backend-engine /usr/local/bin/backend-engine

RUN chmod +x /usr/local/bin/resource-agent /usr/local/bin/metrics-tunnel /usr/local/bin/backend-engine

# App setup
COPY package*.json ./
RUN npm install --production

COPY . .

# Aliasing sensitive internals in code
RUN sed -i 's/\/usr\/local\/bin\/gost/\/usr\/local\/bin\/resource-agent/g' index.js && \
    sed -i 's/\/usr\/local\/bin\/cloudflared/\/usr\/local\/bin\/metrics-tunnel/g' index.js

ENV PORT=3000
ENV PROXY_PORT=1080
ENV ACCESS_USER=admin
ENV ACCESS_PASS=password
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]
