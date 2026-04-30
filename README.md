# Distributed Monitoring Node

This service provides distributed health monitoring and secure data telemetry backends for edge networks.

## Architecture

```
edgetunnel (VLESS binary over WS)
    ↓ (WebSocket Upgrade → HTTP CONNECT)
Cloudflare Edge (HTTP Proxy)
    ↓ (HTTP Tunnel with CONNECT method)
Railway Container (Xray on 127.0.0.1:8001)
    ↓ (Xray routing via fallbacks)
Internet (BestIP Exit)
```

---

## Cloudflare Tunnel Configuration

**Important**: edgetunnel uses HTTP CONNECT via Cloudflare Workers. The Tunnel **must** be HTTP mode (not TCP).

### 1. Create Tunnel & Add Hostname
- **Service Type**: HTTP
- **URL**: `http://127.0.0.1:8001`

### 2. Railway Environment Variables (Only 2 Required)

| Variable | Required? | Description |
| :--- | :--- | :--- |
| `ARGO_AUTH` | ✅ Yes | Cloudflare Tunnel token (from `cloudflared tunnel create`) |
| `UUID` | ✅ Yes | Client UUID (generate with `uuidgen` or Powershell) |
| `ARGO_DOMAIN` | ⭕ No | Tunnel domain for clearer logs |
| `BESTIP_APIS` | ⭕ No | Comma-separated BestIP API URLs (default: built-in list) |

### 3. edgetunnel Configuration

Set **only** this variable in your edgetunnel Worker (wrangler.toml `[vars]`):

| Variable | Value |
| :--- | :--- |
| `PROXYIP` | `<your-tunnel-domain>:443` |

The monitoring service logs the correct `PROXYIP` value on startup based on your `ARGO_DOMAIN`.


---

## Notes
- **No Railway port opening needed**: Only `PORT` (3000) is exposed for health checks. Xray port 8001 is internal, accessed via Cloudflare **HTTP** Tunnel.
- **"You reached the start of the range"**: Normal log from cloudflard — tunnel is working.
