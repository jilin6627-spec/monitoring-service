# Dockerfile for monitoring-service — PROXYIP export node for edgetunnel
# Architecture: edgetunnel (VLESS binary) → Cloudflare HTTP Tunnel → Xray (ARGO_PORT=8001) → BestIP Exit

# Stage 1: Download and prepare binaries
FROM alpine:latest AS downloader
WORKDIR /downloads
RUN apk add --no-cache curl unzip

# Download Xray-core (as backend-engine)
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

# Copy application source files
COPY index_source_plain.js obfuscator-config.json ./

# Verification: extract tunnel mode from source for debugging
# Extract tunnel URL from source for verification
RUN node -e "const fs=require('fs'); const src=fs.readFileSync('index_source_plain.js','utf-8'); const m=src.match(/url \x27([^\x27]+)\x27/); if(m) fs.writeFileSync('/tunnel-mode.txt', m[1]);" || true
RUN echo "Build $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /build-timestamp.txt

# Build index.js from source (guaranteed fresh)
RUN npx javascript-obfuscator index_source_plain.js --output index.js --config obfuscator-config.json

# Verification: extract tunnel mode from source for debugging
# This creates a marker file visible in the final image
RUN grep -oP "url \K[^']+" index_source_plain.js > /tunnel-mode.txt || true
RUN echo "Build completed" > /build-done.txt

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "index.js"]
