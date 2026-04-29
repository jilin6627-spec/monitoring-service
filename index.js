'use strict';

/**
 * rw-eg-proxyip
 * 这是一个专门为 edgetunnel 设计的后端出口 (PROXYIP) 模块。
 * 
 * 核心逻辑：
 * 1. 启动一个受用户名密码保护的 Socks5/HTTP 代理（默认监听在内部）。
 * 2. 通过 Cloudflare Tunnel (Argo) 将其安全地暴露出去。
 * 3. 运行一个简单的静态网站，伪装成普通 Web 服务以绕过检测。
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');

const app = express();

// ========== 1. 变量 (来自环境变量) ==========
const PORT = process.env.PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 1080;
const PROXY_USER = process.env.PROXY_USER || 'admin';
const PROXY_PASS = process.env.PROXY_PASS || 'password';
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
  log('Starting rw-eg-proxyip backend...');

  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

  // 1. 启动 Gost 代理服务器
  // gost -L=auth://user:pass@:1080?probe_http=80 (增加探测伪装)
  const gostPath = '/usr/local/bin/gost';
  const gostCmd = `${gostPath} -L="${PROXY_USER}:${PROXY_PASS}@:${PROXY_PORT}"`;
  const gostProc = exec(gostCmd);
  gostProc.on('error', (err) => log(`Gost Error: ${err.message}`));
  log(`Proxy server listening on port ${PROXY_PORT} (User: ${PROXY_USER})`);

  // 2. 启动 Cloudflare Tunnel
  const cfPath = '/usr/local/bin/cloudflared';
  let cfArgs = `tunnel --no-autoupdate --url tcp://127.0.0.1:${PROXY_PORT}`;
  
  if (ARGO_TOKEN) {
    if (ARGO_TOKEN.includes('TunnelSecret')) {
      // 这里的逻辑可以根据你的具体配置映射调整
      log('Usage of Config mode detected.');
    } else if (ARGO_TOKEN.length > 50) {
      cfArgs = `tunnel --no-autoupdate --token ${ARGO_TOKEN}`;
    }
  }

  const cfProc = exec(`${cfPath} ${cfArgs}`);
  cfProc.on('error', (err) => log(`Tunnel Error: ${err.message}`));
  log('Cloudflare Tunnel initiated.');

  // 3. 将代理信息汇总输出，方便 edgetunnel 填入
  setTimeout(() => {
    log('==================================================');
    log('EDGETUNNEL PROXYIP CONFIGURATION:');
    log(`Address: ${ARGO_DOMAIN || 'Check your Cloudflare Dashboard'}`);
    log(`Authentication: ${PROXY_USER}:${PROXY_PASS}`);
    log(`Protocol: Socks5/HTTP`);
    log('==================================================');
  }, 10000);
}

// 启动端口伪装服务
app.listen(PORT, '0.0.0.0', () => {
  log(`Web monitor running on port ${PORT}`);
  start().catch(err => log(`Fatal: ${err.message}`));
});
