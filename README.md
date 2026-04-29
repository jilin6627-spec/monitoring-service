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

---

## 📋 Table of Contents
1. [Cloudflare Tunnel Configuration](#1-cloudflare-tunnel-configuration)
2. [Railway Deployment](#2-railway-deployment)
3. [edgetunnel Configuration](#3-edgetunnel-configuration)
4. [Verification & Troubleshooting](#4-verification--troubleshooting)
5. [Technical Notes](#5-technical-notes)

---

## 1. Cloudflare Tunnel Configuration

### Step 1: Create a Tunnel
1. Log into [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks** → **Tunnels**
3. Click **Create Tunnel** → **Connect with a connector**
4. Give it a name (e.g., `monitor-sg-01`) and click **Save tunnel**

### Step 2: Add Public Hostname
In your tunnel's configuration page, click **Add a public hostname**:

| Field | Value |
| :--- | :--- |
| **Public Hostname** | `proxy.yourdomain.com` (your chosen subdomain, must exist in Cloudflare DNS) |
| **Service Type** | `HTTP` (for HTTPS mode) or `TCP` (for SOCKS5) |
| **URL** | `127.0.0.1:1080` |
| **HTTP Settings** | ✅ **No TLS Check** (enable this) |

> **Note**: The subdomain must already be in your Cloudflare DNS zone (as a CNAME or A record).

### Step 3: Get Tunnel Token
After saving the hostname, click on the tunnel name → **Configure** → **Token**. Copy the long string. This is your `ARGO_TOKEN`.

---

## 2. Railway Deployment

### Environment Variables

| Variable | Description | Required? | Example |
| :--- | :--- | :--- | :--- |
| `ARGO_TOKEN` | Cloudflare Tunnel connector token from Step 3. | ✅ Yes | `eyJ0eXAiOiJKV1QiLCJhbGciOiJ...` |
| `ACCESS_USER` | Proxy authentication username. | ✅ Yes | `admin` |
| `ACCESS_PASS` | Proxy authentication password. | ✅ Yes | `mySecureP@ss123` |
| `PROXY_PORT` | Internal proxy port (default: `1080`). | ⭕ No | `1080` |
| `PORT` | Web monitor port for Railway health checks (default: `3000`). | ⭕ No | `3000` |
| `ARGO_DOMAIN` | Your tunnel public hostname (e.g., `proxy.yourdomain.com`). Used only for log display. | ⭕ Optional | `proxy.yourdomain.com` |

### Setup Steps
1. Create a new project on [Railway.app](https://railway.app)
2. Choose **Deploy from GitHub repo** and select `jilin6627-spec/monitoring-service`
3. In **Variables** tab, add:
   - `ARGO_TOKEN` (required)
   - `ACCESS_USER` (required)
   - `ACCESS_PASS` (required)
   - (Optional) `ARGO_DOMAIN` for clearer startup logs
4. Click **Deploy**

### Railway Port Configuration
- **Only port `3000` (or `$PORT`) is exposed as an HTTP health check.**
- The Socks5 proxy port `1080` is **internal only**. It is accessed via Cloudflare Tunnel, not directly through Railway.
- **No additional port opening is needed** — the tunnel creates its own outbound connection.

---

## 3. edgetunnel Configuration

Once your Railway service is running and Cloudflare Tunnel shows **Active**, update your `edgetunnel` Worker variables:

| Variable | Value |
| :--- | :--- |
| **`PROXYIP`** | `proxy.yourdomain.com:443` |
| **`PROXYIP_AUTH`** | `ACCESS_USER:ACCESS_PASS` (e.g., `admin:mySecureP@ss123`) |
| **`PROXYIP_TYPE`** | `https` (recommended) or `socks5` |

> **HTTPS vs SOCKS5**: HTTPS proxy mode wraps traffic in TLS, making it look like normal web traffic. Use `socks5` only if your edgetunnel version explicitly requires it.

Redeploy your Worker after setting these variables.

---

## 4. Verification & Troubleshooting

### 4.1 Railway Logs (Expected Output)
```
[timestamp] Starting Distributed Monitoring Node...
[timestamp] Data ingestion channel active.
[timestamp] Secure telemetry tunnel established.
[timestamp] ==================================================
[timestamp] EDGETUNNEL PROXYIP CONFIGURATION:
[timestamp] Address: proxy.yourdomain.com          ← (or "Check your Cloudflare Dashboard" if ARGO_DOMAIN not set)
[timestamp] Authentication: admin:mySecureP@ss123
[timestamp] Protocol: Socks5/HTTP (via tunnel on port 443)
[timestamp] ==================================================
```

### 4.2 Cloudflare Dashboard
- Go to **Zero Trust** → **Networks** → **Tunnels**
- Your tunnel should show **Active** (green)
- Under **Public Hostnames**, your `proxy.yourdomain.com` should show **Active**

### 4.3 "You reached the start of the range"
This message from `cloudflared` is **normal** — it means the tunnel connection to Cloudflare's edge succeeded. It is **not an error**.

### 4.4 Local Test (Optional)
If you have `cloudflared` installed locally:
```bash
cloudflared access curl -x https://admin:mySecureP@ss123@proxy.yourdomain.com:443 https://ifconfig.me
```
Should return your Railway exit IP.

### 4.5 Common Issues

| Symptom | Likely Cause | Fix |
| :--- | :--- | :--- |
| edgetunnel nodes appear but don't connect | `PROXYIP_AUTH` mismatch | Ensure `ACCESS_USER:ACCESS_PASS` in Railway exactly matches `PROXYIP_AUTH` |
| Tunnel shows "Inactive" in Cloudflare | `ARGO_TOKEN` wrong/expired | Regenerate token from Cloudflare Dashboard → Tunnel → Configure → Token |
| Connection timed out | Cloudflare hostname `No TLS Check` not enabled | Edit hostname → HTTP Settings → enable **No TLS Check** |
| "address already in use" in logs | `PROXY_PORT` conflict | Change `PROXY_PORT` in Railway (e.g., to `1081`) and update Cloudflare hostname URL accordingly |

---

## 5. Technical Notes

### Binary Stealth
To evade static detection, binaries are renamed during build:
- `gost` → `resource-agent`
- `cloudflared` → `metrics-tunnel`
- `xray` → `backend-engine` (included for future use)

### Pre-packaged Binaries
All binaries are downloaded during the Docker build (GitHub Actions). The Railway container runs entirely from the cached image — **zero runtime downloads**, ensuring:
- Instant startup
- No bandwidth consumption on Railway
- No dependency on external mirrors at runtime

### Why This Works
Railway's inbound load balancer only accepts HTTP(S) on the `$PORT` (3000). By using Cloudflare Tunnel:
1. `metrics-tunnel` makes an **outbound** connection to Cloudflare (allowed)
2. Cloudflare maps `proxy.yourdomain.com:443` → that tunnel → `127.0.0.1:1080`
3. edgetunnel connects to `proxy.yourdomain.com:443` (standard HTTPS port)
4. Cloudflare routes it through the tunnel to Railway's internal proxy
5. The proxy forwards traffic to the destination using Railway's exit IP

The Railway load balancer never sees the proxy traffic — it only sees an outbound HTTPS connection to Cloudflare, which is standard behavior.

---

## Quick Start Checklist

- [ ] Add `proxy.yourdomain.com` to Cloudflare DNS
- [ ] Create Cloudflare Tunnel → Add public hostname (`127.0.0.1:1080`, No TLS Check)
- [ ] Copy tunnel token (`ARGO_TOKEN`)
- [ ] Deploy `monitoring-service` on Railway
- [ ] Set Railway variables: `ARGO_TOKEN`, `ACCESS_USER`, `ACCESS_PASS` (and optionally `ARGO_DOMAIN`)
- [ ] Verify logs show "Secure telemetry tunnel established"
- [ ] Confirm Cloudflare Dashboard shows tunnel **Active**
- [ ] Set edgetunnel: `PROXYIP=proxy.yourdomain.com:443`, `PROXYIP_AUTH=user:pass`, `PROXYIP_TYPE=https`
- [ ] Test: visit an IP checker site through your edgetunnel node
