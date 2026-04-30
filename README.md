# Distributed Monitoring Node

This service provides distributed health monitoring and secure data telemetry backends for edge networks.

## Architecture

```
edgetunnel (VLESS binary over WS)
    ↓ (WebSocket Upgrade)
Cloudflare Edge (Native Protocol)
    ↓ (TCP Tunnel: raw binary)
Railway Container (Xray on 127.0.0.1:8001)
    ↓ (Xray routing via fallbacks)
Internet (BestIP Exit)
```

---

## Cloudflare Tunnel Configuration

### 1. Create Tunnel & Add Hostname
- **Service Type**: TCP
- **URL**: `127.0.0.1:8001`
- **HTTP Settings**: 

### 2. Railway Environment Variables (Only 2 Required)

| Variable | Required? | Description |
| :--- | :--- | :--- |
| `ARGO_AUTH` | ✅ Yes | Cloudflare Tunnel token (from `cloudflared tunnel create`) |
| `UUID` | ✅ Yes | Client UUID (generate with `uuidgen` or Powershell) |
| `ARGO_DOMAIN` | ⭕ No | Tunnel domain for clearer logs |
| `BESTIP_APIS` | ⭕ No | Comma-separated BestIP API URLs (default: built-in list) |

### 3. edgetunnel Configuration

| Variable | Value |
| :--- | :--- |
| `PROXYIP` | `yourdomain.com:443` |


---

## Notes
- **No Railway port opening needed**: Only `PORT` (3000) is exposed for health checks. Xray port 8001 and fallback ports are internal, accessed via Cloudflare TCP Tunnel.
- **"You reached the start of the range"**: Normal log from cloudflared — tunnel is working.
