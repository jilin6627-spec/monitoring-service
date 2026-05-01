'use strict';

/**
 * monitoring-service - PROXYIP Export for edgetunnel
 * Architecture: edgetunnel (VLESS binary over WS) → Cloudflare TCP Tunnel → Xray (ARGO_PORT) → Exit
 *
 * 这个版本恢复 Xray 作为核心协议处理器，移除 Gost。
 * Cloudflare Tunnel 使用 TCP 模式指向 Xray 的 ARGO_PORT。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const express = require('express');
const axios = require('axios');
const { execSync, exec } = require('child_process');

const app = express();

// ========== 1. 环境变量 ==========
const PORT = process.env.PORT || 3000;
const FILE_PATH = path.resolve(process.env.FILE_PATH || './tmp');
const UUID = process.env.UUID || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
// Railway 端只是 edgetunnel 的 PROXYIP 后端，不再内置第三方优选域名。
// 最终客户端入口应由 edgetunnel 订阅自动下发；这里的 /sub 仅作为直连/调试备用。
const CFIP = process.env.CFIP || ARGO_DOMAIN || '';
const CFPORT = process.env.CFPORT || '443';
const NAME = process.env.NAME || '';
const SUB_PATH = process.env.SUB_PATH || 'sub';

const BESTIP_APIS = (process.env.BESTIP_APIS || process.env.EDGETUNNEL_API || '').split(',').map(s => s.trim()).filter(Boolean);
const BESTIP_INTERVAL = parseInt(process.env.BESTIP_INTERVAL) || 4 * 60 * 60 * 1000;
const BESTIP_CONCURRENCY = parseInt(process.env.BESTIP_CONCURRENCY) || 10;
const BESTIP_TIMEOUT = parseInt(process.env.BESTIP_TIMEOUT) || 3000;
const BESTIP_TOP_N = parseInt(process.env.BESTIP_TOP_N) || 3;

// ========== 2. 全局状态 ==========
let xrayProcess = null;
let cloudflaredProcess = null;
let currentBestIP = CFIP;
let bestIPResults = [];
let lastTestTime = 0;
let testRunning = false;

// ========== 3. 日志 ==========
function log(prefix, msg, type = 'info') {
  const c = { info: '\\x1b[36m', success: '\\x1b[32m', warn: '\\x1b[33m', error: '\\x1b[31m', reset: '\\x1b[0m' };
  console.log(`${c[type]}${new Date().toISOString()} [${prefix}] ${msg}${c.reset}`);
}

// ========== 4. 优选IP核心模块 ==========
function testTCPLatency(host, port, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ host, port, latency, ok: true });
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ host, port, latency: timeout, ok: false }); });
    socket.on('error', () => { socket.destroy(); resolve({ host, port, latency: timeout, ok: false }); });
    socket.connect(parseInt(port) || 443, host);
  });
}

async function fetchIPsFromSource(apiUrl) {
  try {
    log('FETCH', `从 ${apiUrl} 获取IP列表...`);
    const resp = await axios.get(apiUrl, { timeout: 10000, headers: { 'User-Agent': 'monitoring-service/1.0' } });
    let data = typeof resp.data === 'string' ? resp.data.trim() : JSON.stringify(resp.data);

    if (data.length > 50 && !data.includes('\n') && !data.includes('://')) {
      try { data = Buffer.from(data, 'base64').toString('utf8'); } catch (e) {}
    }

    const ips = [];
    // 解析 vless/vmess/trojan 链接: vless://uuid@ip:port
    const linkRegex = /(?:vless|vmess|trojan):\/\/[^@]*@([^:]+):(\d+)/g;
    let m;
    while ((m = linkRegex.exec(data)) !== null) {
      ips.push({ ip: m[1], port: m[2], source: apiUrl });
    }
    if (ips.length === 0) {
      for (const line of data.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(':');
        const ip = parts[0].trim();
        const port = parts[1]?.trim() || '443';
        if (/^[\\d.]+$/.test(ip) || /^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(ip)) {
          ips.push({ ip, port, source: apiUrl });
        }
      }
    }
    log('FETCH', `从 ${apiUrl} 获取到 ${ips.length} 个IP`, 'success');
    return ips;
  } catch (err) {
    log('ERROR', `获取 ${apiUrl} 失败: ${err.message}`, 'error');
    return [];
  }
}

async function testIPsBatch(ipList, concurrency, timeout) {
  const results = [];
  for (let i = 0; i < ipList.length; i += concurrency) {
    const batch = ipList.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(item => testTCPLatency(item.ip, item.port, timeout).then(r => ({ ...r, source: item.source })))
    );
    results.push(...batchResults);
  }
  return results.filter(r => r.ok).sort((a, b) => a.latency - b.latency);
}

async function runBestIPTest() {
  if (testRunning) { log('BESTIP', '测速正在进行中，跳过', 'warn'); return; }
  if (BESTIP_APIS.length === 0) { log('BESTIP', '未配置BESTIP_APIS，使用静态CFIP', 'warn'); return; }

  testRunning = true;
  log('BESTIP', '========== 开始优选IP测速 ==========', 'info');
  const startTime = Date.now();

  try {
    const allFetches = await Promise.all(BESTIP_APIS.map(url => fetchIPsFromSource(url)));
    let allIPs = allFetches.flat();
    const seen = new Set();
    allIPs = allIPs.filter(item => {
      const key = `${item.ip}:${item.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (allIPs.length === 0) {
      log('BESTIP', '未获取到任何IP，保持当前配置', 'warn');
      return;
    }

    const results = await testIPsBatch(allIPs, BESTIP_CONCURRENCY, BESTIP_TIMEOUT);
    if (results.length > 0) {
      bestIPResults = results.slice(0, BESTIP_TOP_N).map(r => ({
        ip: r.host, port: r.port, latency: r.latency, source: r.source, testedAt: new Date().toISOString()
      }));
      const oldIP = currentBestIP;
      currentBestIP = bestIPResults[0].ip;
      lastTestTime = Date.now();

      if (oldIP !== currentBestIP) {
        log('BESTIP', `*** 最佳IP已更新: ${oldIP} → ${currentBestIP} (${bestIPResults[0].latency}ms) ***`, 'success');
        const argoDomain = ARGO_DOMAIN || await extractDomains();
        if (argoDomain) generateLinks(argoDomain, currentBestIP);
      }
    }
  } catch (err) {
    log('ERROR', `测速异常: ${err.message}`, 'error');
  } finally {
    testRunning = false;
    log('BESTIP', `测速耗时 ${Date.now() - startTime}ms`);
  }
}

// ========== 5. HTTP路由 ==========
app.get('/', (req, res) => res.send('monitoring-service running'));
app.get('/health', (req, res) => res.json({ status: 'ok', bestIP: currentBestIP }));
app.get('/bestip', (req, res) => res.json({ currentBestIP, lastTestTime: lastTestTime ? new Date(lastTestTime).toISOString() : 'never', topResults: bestIPResults }));

// ========== 6. Xray配置生成 ==========
async function getMetaInfo() {
  try {
    const r = await axios.get('https://ipapi.co/json/', { timeout: 5000 });
    return r.data.org || 'Cloudflare';
  } catch (e) { return 'Cloudflare'; }
}

async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      {
        port: parseInt(ARGO_PORT), listen: '127.0.0.1', protocol: 'vless',
        settings: {
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none',
          fallbacks: [
            { dest: '127.0.0.1:1080' }, // 默认转发到 SOCKS5, 兼容 PROXYIP
            { dest: '127.0.0.1:3002', path: '/vless-argo' },
            { dest: '127.0.0.1:3003', path: '/vmess-argo' },
            { dest: '127.0.0.1:3004', path: '/trojan-argo' }
          ]
        },
        streamSettings: { network: 'tcp', security: 'none' },
        sniffing: { enabled: true, destOverride: ["http", "tls"] }
      },
      // SOCKS5 代理入站 (供 PROXYIP 或外部中转)
      { port: 1080, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } },
      // HTTP 代理入站
      { port: 8118, listen: '127.0.0.1', protocol: 'http', settings: { allowTransparent: false } },
      { port: 3001, listen: '127.0.0.1', protocol: 'vless', settings: { clients: [{ id: UUID }], decryption: 'none' }, streamSettings: { network: 'tcp' } },
      { port: 3002, listen: '127.0.0.1', protocol: 'vless', settings: { clients: [{ id: UUID }], decryption: 'none' }, streamSettings: { network: 'ws', wsSettings: { path: '/vless-argo' } } },
      { port: 3003, listen: '127.0.0.1', protocol: 'vmess', settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: 'ws', wsSettings: { path: '/vmess-argo' } } },
      { port: 3004, listen: '127.0.0.1', protocol: 'trojan', settings: { clients: [{ password: UUID }] }, streamSettings: { network: 'ws', wsSettings: { path: '/trojan-argo' } } }
    ],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// ========== 7. 二进制准备 ==========
function getDownloadInfo() {
  const arch = os.arch();
  const m = { x64: ['64', 'amd64'], arm64: ['arm64-v8a', 'arm64'] };
  const [xm, ca] = m[arch] || m.x64;
  return {
    xrayURL: `https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${xm}.zip`,
    cloudflaredURL: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ca}`,
    xrayMachine: xm
  };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    exec(`curl -L -o "${dest}" "${url}"`, (err) => err ? reject(err) : resolve(dest));
  });
}

async function prepareBinaries(callback) {
  const { xrayURL, cloudflaredURL, xrayMachine } = getDownloadInfo();
  const xrayZip = path.join(FILE_PATH, `Xray-linux-${xrayMachine}.zip`);
  const xrayBin = path.join(FILE_PATH, 'xray');
  const cfPath = path.join(FILE_PATH, 'cloudflared');

  if (fs.existsSync(xrayBin) && fs.existsSync(cfPath)) {
    log('BIN', '预装二进制就绪');
  } else {
    log('BIN', '开始准备二进制...');
    if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
    await downloadFile(xrayURL, xrayZip);
    try { execSync(`unzip -o "${xrayZip}" -d "${FILE_PATH}"`); } catch (e) {}
    await downloadFile(cloudflaredURL, cfPath);
    execSync(`chmod +x "${xrayBin}" "${cfPath}"`);
  }
  if (callback) await callback();
}

// ========== 8. 域名提取 ==========
async function extractDomains() {
  if (ARGO_DOMAIN) return ARGO_DOMAIN;
  const bootLog = path.join(FILE_PATH, 'boot.log');
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 3000));
    if (fs.existsSync(bootLog)) {
      const content = fs.readFileSync(bootLog, 'utf-8');
      const m = content.match(/https?:\/\/([a-z0-9]+\.trycloudflare\.com)/);
      if (m) return m[1];
    }
  }
  return null;
}

// ========== 9. 订阅生成 ==========
async function generateLinks(argoDomain, entryIP) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  const ip = entryIP || currentBestIP;

  const vless = `vless://${UUID}@${ip}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent('/vless-argo?ed=2560')}#${encodeURIComponent(nodeName)}`;
  const vmessObj = { v: '2', ps: nodeName, add: ip, port: CFPORT, id: UUID, aid: 0, net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo', tls: 'tls', sni: argoDomain, fp: 'firefox' };
  const vmess = `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`;
  const trojan = `trojan://${UUID}@${ip}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=${encodeURIComponent('/trojan-argo?ed=2560')}#${encodeURIComponent(nodeName)}`;

  let allLinks = `${vless}\n${vmess}\n${trojan}\n`;
  const subB64 = Buffer.from(allLinks).toString('base64');
  fs.writeFileSync(path.join(FILE_PATH, 'sub.txt'), subB64);

  app.get(`/${SUB_PATH}`, (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    try { res.send(fs.readFileSync(path.join(FILE_PATH, 'sub.txt'), 'utf-8')); }
    catch (e) { res.send(subB64); }
  });
}

// ========== 10. 主程序 ==========
async function startserver() {
  log('START', 'monitoring-service 正在初始化...');
  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

  await prepareBinaries(async () => {
    await generateConfig();

    // 启动 Xray (监听在 ARGO_PORT，如 8001)
    const xrayPath = path.join(FILE_PATH, 'xray');
    xrayProcess = exec(`${xrayPath} -c ${path.join(FILE_PATH, 'config.json')}`, { cwd: FILE_PATH });
    xrayProcess.on('error', err => log('XRAY', `错误: ${err.message}`, 'error'));
    xrayProcess.stdout?.on('data', data => String(data).trim().split('\n').filter(Boolean).forEach(line => log('XRAY', line)));
    xrayProcess.stderr?.on('data', data => String(data).trim().split('\n').filter(Boolean).forEach(line => log('XRAY', line, 'warn')));
    log('XRAY', `Xray已启动，监听端口: ${ARGO_PORT}`);

    // 启动 Cloudflare Tunnel - TCP 模式 (透传所有协议)
    const cfPath = path.join(FILE_PATH, 'cloudflared');
    let cfArgs = `tunnel --no-autoupdate --url tcp://127.0.0.1:${ARGO_PORT}`;
    if (ARGO_AUTH) {
      if (ARGO_AUTH.includes('TunnelSecret')) {
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), JSON.stringify(JSON.parse(ARGO_AUTH), null, 2));
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), `tunnel: ${JSON.parse(ARGO_AUTH).Tunnel}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\n`);
        cfArgs = `tunnel --no-autoupdate --config ${path.join(FILE_PATH, 'tunnel.yml')}`;
      } else {
        cfArgs = `tunnel --no-autoupdate run --token ${ARGO_AUTH}`;
      }
    }
    log('DEBUG', `Cloudflared cfArgs: ${cfArgs}`, 'info');
    cloudflaredProcess = exec(`${cfPath} ${cfArgs}`, { cwd: FILE_PATH });
    cloudflaredProcess.on('error', err => log('TUNNEL', `错误: ${err.message}`, 'error'));
    cloudflaredProcess.stdout?.on('data', data => String(data).trim().split('\n').filter(Boolean).forEach(line => log('TUNNEL', line)));
    cloudflaredProcess.stderr?.on('data', data => String(data).trim().split('\n').filter(Boolean).forEach(line => log('TUNNEL', line, 'warn')));
    log('TUNNEL', 'Cloudflared HTTP 隧道已启动');

    // 等待隧道就绪
    await new Promise(r => setTimeout(r, 5000));

    const argoDomain = await extractDomains();
    if (!argoDomain) { log('ERROR', '无法获取隧道域名，请检查 ARGO_AUTH/ARGO_DOMAIN', 'error'); return; }

    log('SUCCESS', `隧道域名: ${argoDomain}`, 'success');
    log('CONFIG', `edgetunnel 请使用: PROXYIP=${argoDomain}:443`, 'info')

    // 首次测速
    await runBestIPTest();
    await generateLinks(argoDomain, currentBestIP);

    // 定时任务
    setInterval(() => runBestIPTest(), BESTIP_INTERVAL);
  });
}

app.listen(PORT, '0.0.0.0', () => log('HTTP', `Web 服务: 0.0.0.0:${PORT}`));
startserver().catch(err => log('FATAL', `启动失败: ${err.message}`, 'error'));
