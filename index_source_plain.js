'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const express = require('express');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

// ========== 配置 ==========
const PORT = process.env.PORT || 3000;
const FILE_PATH = path.resolve(process.env.FILE_PATH || './tmp');
const UUID = process.env.UUID || '88888888-4444-4444-4444-121212121212';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const SUB_PATH = process.env.SUB_PATH || 'sub';

// 常用优选域名列表 (本地网络友好)
const PREFERRED_DOMAINS = [
    'cdns.doon.eu.org',
    'cf.090227.xyz',
    'icook.hk',
    'www.visa.com.sg',
    'www.wto.org',
    'www.digitalocean.com'
];

if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

// ========== API 路由 ==========
app.get('/', (req, res) => res.send('Worker is ready.'));

app.get(`/${SUB_PATH}`, async (req, res) => {
    const host = ARGO_DOMAIN || req.hostname;
    let links = '';
    
    // 生成基于优选域名的 VLESS 节点
    PREFERRED_DOMAINS.forEach(domain => {
        const name = `RW-${domain}`;
        const vless = `vless://${UUID}@${domain}:443?encryption=none&security=tls&sni=${host}&fp=firefox&type=ws&host=${host}&path=${encodeURIComponent('/vless-argo?ed=2560')}#${encodeURIComponent(name)}`;
        links += vless + '\n';
    });

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(Buffer.from(links).toString('base64'));
});

// ========== 下级服务启动 ==========
function startXray() {
    const config = {
        log: { loglevel: "none" },
        inbounds: [{
            port: 3001, listen: "127.0.0.1", protocol: "vless",
            settings: { clients: [{ id: UUID }], decryption: "none" },
            streamSettings: { network: "ws", wsSettings: { path: "/vless-argo" } }
        }],
        outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config));
    
    const xrayURL = `https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip`;
    exec(`curl -L -o ${path.join(FILE_PATH, 'x.zip')} ${xrayURL} && unzip -o ${path.join(FILE_PATH, 'x.zip')} -d ${FILE_PATH} && chmod +x ${path.join(FILE_PATH, 'xray')}`, (err) => {
        if (!err) exec(`${path.join(FILE_PATH, 'xray')} -c ${path.join(FILE_PATH, 'config.json')}`);
    });
}

function startArgo() {
    const cfPath = path.join(FILE_PATH, 'cloudflared');
    const cfURL = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64`;
    
    exec(`curl -L -o ${cfPath} ${cfURL} && chmod +x ${cfPath}`, (err) => {
        if (!err) {
            let args = `tunnel --no-autoupdate --url http://127.0.0.1:${PORT}`;
            if (ARGO_AUTH) {
                if (ARGO_AUTH.includes('TunnelSecret')) {
                    fs.writeFileSync(path.join(FILE_PATH, 't.json'), ARGO_AUTH);
                    args = `tunnel --no-autoupdate --credentials-file ${path.join(FILE_PATH, 't.json')} run`;
                } else {
                    args = `tunnel --no-autoupdate run --token ${ARGO_AUTH}`;
                }
            }
            exec(`${cfPath} ${args}`);
        }
    });
}

// ========== WebSocket 分流 (核心) ==========
server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/vless-argo')) {
        const target = { host: '127.0.0.1', port: 3001 };
        const proxySocket = require('net').connect(target.port, target.host, () => {
            proxySocket.write(head);
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
            proxySocket.pipe(socket).pipe(proxySocket);
        });
        proxySocket.on('error', () => socket.destroy());
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    startXray();
    startArgo();
});
