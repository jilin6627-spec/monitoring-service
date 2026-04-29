# Distributed Monitoring Node

This service provides distributed health monitoring and secure data telemetry backends.

## 1. Cloudflare Tunnel (Argo) Configuration

To establish a secure link, configure your Tunnel in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/):

1.  **Create a Tunnel**: Go to `Networks` -> `Tunnels` and create a New Tunnel.
2.  **Add a Public Hostname**:
    *   **Public Hostname**: `monitor-node.yourdomain.com`
    *   **Service Type**: `HTTP` (Recommended for edgetunnel HTTPS mode) or `TCP` (For SOCKS5).
    *   **URL**: `127.0.0.1:1080`
3.  **HTTP Settings (Important)**:
    *   Toggle **`No TLS Check`** ON.

## 2. Deployment on Railway

Set the following variables:
- `ARGO_TOKEN`: Your Cloudflare Tunnel Token.
- `ACCESS_USER`: Username for data ingestion (e.g., `admin`).
- `ACCESS_PASS`: Password for data ingestion.

## 3. Connecting edgetunnel (CF Workers)

Once the service is active, use the following generated variables in your `edgetunnel` config:

| Variable | Value |
| :--- | :--- |
| **`PROXYIP`** | `monitor-node.yourdomain.com:443` |
| **`PROXYIP_AUTH`** | `ACCESS_USER:ACCESS_PASS` |
| **`PROXYIP_TYPE`** | `https` (or `socks5`) |

---

## Technical Details

- **Binary Aliasing**: Internally, core engines are renamed to `resource-agent` and `metrics-tunnel` to prevent process-level fingerprinting.
- **Pre-packaged**: All necessary binaries are downloaded during the GitHub/Docker build stage, ensuring zero downloads during Railway runtime.
