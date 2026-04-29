'use strict';

/**
 * rw-eg-proxyip
 * 这是一个专门为 edgetunnel 设计的后端出口 (PROXYIP) 模块。
 * 
 * 核心逻辑：
 * 1. 启动一个受用户名密码保护的 Socks5 代理（端口 1080）。
 * 2. 同时启动一个 HTTP/HTTPS 代理（端口 8080），供 edgetunnel 的 HTTPS 模式使用。
 * 3. 通过 Cloudflare Tunnel (Argo) 将 HTTP 代理安全地暴露出去。
 * 4. 运行一个简单的静态网站，伪装成普通 Web 服务以绕过检测。
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');

const app = express();

// ========== 1. 变量 (来自环境变量) ==========
const PORT = process.env.PORT || 3000;
const SOCKS5_PORT = process.env.SOCKS5_PORT || process.env.PROXY_PORT || 1080;
const HTTP_PROXY_PORT = process.env.HTTP_PROXY_PORT || 8080;
const ACCESS_USER = process.env.ACCESS_USER || process.env.PROXY_USER || 'admin';
const ACCESS_PASS = process.env.ACCESS_PASS || process.env.PROXY_PASS || 'password';
const ARGO_TOKEN = process.env.ARGO_TOKEN || process.env.ARGO_AUTH || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const FILE_PATH = '/app/tmp';

// ========== 2. 日志 ==========
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ========== 3. 仿制普通 Web 服务 ==========
app.get('/', (req, res) => {
  res.send('<html><head><title>System Status</title></head><body><h1>Resource Monitoring service is active.</h1><p>Node healthy.</p></body></html>');
});

// ========== 4. 核心程序启动 ==========
async function start() {
  log('Starting Distributed Monitoring Node...');

  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

  // 1. 启动 Gost - Socks5 代理 (用于 TCP 隧道模式或备用)
  const resourceAgentPath = '/usr/local/bin/resource-agent';
  exec(`${resourceAgentPath} -L="socks5://${ACCESS_USER}:${ACCESS_PASS}@:${SOCKS5_PORT}"`);
  log(`Socks5 proxy listening on port ${SOCKS5_PORT}`);

  // 2. 启动 Gost - HTTP/HTTPS 代理 (用于 edgetunnel HTTPS 模式)
  exec(`${resourceAgentPath} -L="http://${ACCESS_USER}:${ACCESS_PASS}@:${HTTP_PROXY_PORT}"`);
  log(`HTTP/HTTPS proxy listening on port ${HTTP_PROXY_PORT}`);

  // 3. 启动 Cloudflare Tunnel - 指向 HTTP 代理端口
  const cfPath = '/usr/local/bin/metrics-tunnel';
  let cfArgs = `tunnel --no-autoupdate --url http://127.0.0.1:${HTTP_PROXY_PORT}`;
  
  if (ARGO_TOKEN) {
    if (ARGO_TOKEN.includes('TunnelSecret')) {
      log('Encrypted config mode active.');
    } else if (ARGO_TOKEN.length > 50) {
      cfArgs = `tunnel --no-autoupdate --token ${ARGO_TOKEN}`;
    }
  }

  const cfProc = exec(`${cfPath} ${cfArgs}`);
  cfProc.on('error', (err) => log(`Tunnel Link Error: ${err.message}`));
  log('Secure telemetry tunnel established.');

  // 4. 输出配置信息
  setTimeout(() => {
    log('==================================================');
    log('EDGETUNNEL PROXYIP CONFIGURATION (HTTPS Mode):');
    log(`Address: ${ARGO_DOMAIN || 'Set ARGO_DOMAIN for exact domain, else check Cloudflare Dashboard'}`);
    log(`Authentication: ${ACCESS_USER}:${ACCESS_PASS}`);
    log(`Protocol: HTTPS (edgetunnel connects via Cloudflare Tunnel)`);
    log(`Cloudflare Tunnel → Local: http://127.0.0.1:${HTTP_PROXY_PORT}`);
    log('==================================================');
    log('ALTERNATIVE (SOCKS5 Mode):');
    log(`For SOCKS5, point tunnel to: tcp://127.0.0.1:${SOCKS5_PORT}`);
    log('==================================================');
  }, 10000);
}

// 启动端口伪装服务
app.listen(PORT, '0.0.0.0', () => {
  log(`Web monitor running on port ${PORT}`);
  start().catch(err => log(`Fatal: ${err.message}`));
});
