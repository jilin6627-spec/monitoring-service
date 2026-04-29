# Distributed Monitoring Node

This service provides distributed health monitoring and secure data telemetry backends for edge networks.

## Architecture

```
edgetunnel (CF Workers) 
    ↓ (HTTPS CONNECT)
Cloudflare Edge (443)
    ↓ (Encrypted Tunnel)
Railway Container (resource-agent + metrics-tunnel)
    ↓ (HTTP Proxy on 8080 / SOCKS5 on 1080)
Internet (Clean Exit IP)
```

---

## Cloudflare Tunnel Configuration

### 1. Create Tunnel & Add Hostname
- **Service Type**: HTTP
- **URL**: `127.0.0.1:8080`
- **HTTP Settings**: ✅ Enable `No TLS Check`

### 2. Railway Environment Variables

| Variable | Required? | Default |
| :--- | :--- | :--- |
| `ARGO_TOKEN` | ✅ Yes | *(your tunnel token)* |
| `ACCESS_USER` | ✅ Yes | `admin` |
| `ACCESS_PASS` | ✅ Yes | `password` |
| `HTTP_PROXY_PORT` | ⭕ No | `8080` |
| `SOCKS5_PORT` | ⭕ No | `1080` |

### 3. edgetunnel Configuration

| Variable | Value |
| :--- | :--- |
| `PROXYIP` | `yourdomain.com:443` |
| `PROXYIP_AUTH` | `ACCESS_USER:ACCESS_PASS` |
| `PROXYIP_TYPE` | `https` |

---

## Notes
- **Dual proxy**: Runs both HTTP (8080) for edgetunnel HTTPS mode and SOCKS5 (1080) for alternative setups.
- **No Railway port opening needed**: Only `PORT` (3000) is exposed for health checks. Proxy ports are internal.
- **"You reached the start of the range"**: Normal log from cloudflared — tunnel is working.
