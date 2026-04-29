# Distributed Monitoring Node

This service provides distributed health monitoring and secure data telemetry backends for edge networks.

## Architecture

```
edgetunnel (CF Workers) 
    ↓ (HTTPS CONNECT / SOCKS5)
Cloudflare Edge (443)
    ↓ (Encrypted Tunnel)
Railway Container (resource-agent + metrics-tunnel)
    ↓ (Socks5/HTTP Proxy)
Internet (Clean Exit IP)
```

## 1. Cloudflare Tunnel (Argo) Configuration

### Step 1: Create Tunnel
1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) → `Networks` → `Tunnels`.
2. Click **Create Tunnel** → **Connect with a connector** → Give it a name (e.g., `monitor-sg-01`).

### Step 2: Add Public Hostname
In your tunnel's configuration, add a public hostname:

| Field | Value |
| :--- | :--- |
| **Public Hostname** | `proxy.yourdomain.com` (your chosen subdomain) |
| **Service Type** | `HTTP` (Recommended for HTTPS mode) or `TCP` (for SOCKS5) |
| **URL** | `127.0.0.1:1080` |

**Important**: In `HTTP Settings`, toggle **`No TLS Check`** to **ON**.

### Step 3: Get Your Tunnel Token
After creating the tunnel, you'll see a **connector token** (starts with `eyJ...`). Copy it — this is your `ARGO_TOKEN`.

---

## 2. Railway Deployment

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ARGO_TOKEN` | Cloudflare Tunnel Token (from Step 3 above) | *(required)* |
| `ACCESS_USER` | Proxy authentication username | `admin` |
| `ACCESS_PASS` | Proxy authentication password | `password` |
| `PROXY_PORT` | Internal proxy port (do not change unless you know what you're doing) | `1080` |
| `PORT` | Web monitor port (for Railway health checks) | `3000` |

### Deploy
1. Import this repository into Railway.
2. Set the environment variables above.
3. Deploy. The container will:
   - Start a Socks5/HTTP proxy on port 1080.
   - Start Cloudflare Tunnel (`metrics-tunnel`) to expose it.
   - Run a simple web page on port 3000 to pass platform monitoring.

---

## 3. edgetunnel (Cloudflare Workers) Configuration

Once your Railway service is running and the tunnel is active (check Cloudflare Dashboard → Tunnels → `proxy.yourdomain.com` shows **Active**), configure your `edgetunnel` Worker:

### Environment Variables for edgetunnel

| Variable | Value |
| :--- | :--- |
| **`PROXYIP`** | `proxy.yourdomain.com:443` |
| **`PROXYIP_AUTH`** | `ACCESS_USER:ACCESS_PASS` (e.g., `admin:password`) |
| **`PROXYIP_TYPE`** | `https` (preferred) or `socks5` |

> **Note on HTTPS vs SOCKS5**: HTTPS proxy mode is recommended because it blends perfectly with normal web traffic and is less likely to trigger deep packet inspection on either end.

---

## 4. Verification

1. **Railway Logs**: You should see:
   ```
   [timestamp] Starting Distributed Monitoring Node...
   [timestamp] Data ingestion channel active.
   [timestamp] Secure telemetry tunnel established.
   [timestamp] EDGETUNNEL PROXYIP CONFIGURATION:
   [timestamp] Address: proxy.yourdomain.com
   [timestamp] Authentication: admin:password
   ```

2. **Cloudflare Dashboard**: Your tunnel should show **Active** and the public hostname should resolve.

3. **edgetunnel**: After updating environment variables and redeploying, check the Worker logs — you should see the node appear in the subscription with the correct IP (your Railway exit IP).

---

## Technical Notes

### Binary Stealth
All binaries are renamed during build to avoid process-based detection:
- `gost` → `resource-agent`
- `cloudflared` → `metrics-tunnel`
- `xray` → `backend-engine` (included for future extensibility)

### Pre-packaged Binaries
All necessary binaries are downloaded during Docker build (in GitHub Actions). Railway only runs the already-built image — zero bandwidth consumption on their side.

### Why This Works
Railway's load balancer only handles HTTP(S). By using Cloudflare Tunnel, we bypass that entirely and establish a direct TCP bridge from Cloudflare's edge to your container's internal proxy port.
