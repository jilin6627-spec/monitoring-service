# rw-eg-proxyip

这是一个轻量级的 **Cloudflare 优选 IP 出口节点 (PROXYIP)** 项目。

### 部署在 Railway
1. 叉取或部署该仓库。
2. 配置环境变量：
   - `ARGO_TOKEN`: 您的 Cloudflare Tunnel Token。
   - `PROXY_USER`: 代理用户名。
   - `PROXY_PASS`: 代理密码。
3. 获取您的隧道域名。

### 对接到 edgetunnel
在您的 `edgetunnel` Worker 环境变量中填入：
- `PROXYIP`: `您的隧道域名:443`
- `PROXYIP_TYPE`: `socks5`

这样，您的流量就会通过 Cloudflare 进入 Railway 的干净 IP 出口。
