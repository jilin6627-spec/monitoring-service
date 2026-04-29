# Dockerfile for rw-eg-proxyip
# 出口代理优化版 (PROXYIP)

FROM golang:alpine AS builder
WORKDIR /app
# 下载并构建极简版 Gost
RUN apk add --no-cache git && \
    git clone https://github.com/ginuerzh/gost.git && \
    cd gost/cmd/gost && \
    go build -ldflags "-s -w" -o /app/gost

FROM node:18-alpine
WORKDIR /app

# 安装必要工具
RUN apk add --no-cache curl ca-certificates unzip bash tzdata

# 下载 Cloudflared
RUN curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && \
    chmod +x /usr/local/bin/cloudflared

# 从构建阶段复制 Gost
COPY --from=builder /app/gost /usr/local/bin/gost
RUN chmod +x /usr/local/bin/gost

# 安装应用依赖
COPY package*.json ./
RUN npm install --production

# 复制源码
COPY . .

# 环境变量设置
ENV PORT=3000
ENV PROXY_PORT=1080
ENV PROXY_USER=admin
ENV PROXY_PASS=password
ENV NODE_ENV=production

EXPOSE 3000
EXPOSE 1080

CMD ["node", "index.js"]
