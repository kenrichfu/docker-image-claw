const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require('child_process').exec);

// ---------------------------
// 环境变量
// ---------------------------
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.PORT || 3000;

const UUID = process.env.UUID;
const ARGO_DOMAIN = process.env.ARGO_DOMAIN;
const ARGO_AUTH = process.env.ARGO_AUTH;
const NAME = process.env.NAME || '';
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;

if (!UUID) {
    console.error("❌ UUID 缺失！");
    process.exit(1);
}

// ---------------------------
// 创建文件夹
// ---------------------------
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

const webPath = path.join(FILE_PATH, 'web'); // Xray WS
const botPath = path.join(FILE_PATH, 'bot'); // cloudflared

// ---------------------------
// 生成 Xray WS 配置
// ---------------------------
async function generateConfig() {
    const config = {
        log: { loglevel: "none" },
        inbounds: [
            {
                port: PORT,
                protocol: "vless",
                settings: { clients: [{ id: UUID }], decryption: "none" },
                streamSettings: {
                    network: "ws",
                    security: "none",
                    wsSettings: { path: "/ws" }
                }
            }
        ],
        outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// ---------------------------
// 等待端口就绪
// ---------------------------
function waitPortReady(port, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = async () => {
            try {
                await axios.get(`http://127.0.0.1:${port}`);
                resolve();
            } catch (err) {
                if (Date.now() - start > timeout) reject('端口未就绪');
                else setTimeout(check, 500);
            }
        };
        check();
    });
}

// ---------------------------
// 启动 Xray WS
// ---------------------------
async function startXray() {
    if (!fs.existsSync(webPath)) {
        console.error("❌ Xray 二进制不存在:", webPath);
        return;
    }
    await exec(`chmod +x ${webPath}`);
    await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
    console.log('Xray WS 正在启动...');
    await waitPortReady(PORT);
    console.log('Xray WS 已就绪');
}

// ---------------------------
// 启动 cloudflared tunnel
// ---------------------------
async function startTunnel() {
    if (!ARGO_AUTH || !ARGO_DOMAIN) {
        console.log('跳过 Cloudflare tunnel：缺少 ARGO_AUTH 或 ARGO_DOMAIN');
        return;
    }
    if (!fs.existsSync(botPath)) {
        console.error("❌ cloudflared 二进制不存在:", botPath);
        return;
    }
    await exec(`chmod +x ${botPath}`);

    // 简单 token 格式检查
    if (!ARGO_AUTH.match(/^[A-Za-z0-9=_-]{50,250}$/)) {
        console.error('❌ ARGO_AUTH 格式可能不正确，请检查 token');
    }

    const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://127.0.0.1:${PORT} run --token ${ARGO_AUTH}`;
    try {
        await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
        console.log('cloudflared 隧道已启动');
    } catch (err) {
        console.error('启动 cloudflared 失败:', err);
    }
}

// ---------------------------
// 生成订阅链接
// ---------------------------
async function generateLinks() {
    const nodeName = NAME || 'ClawNode';
    const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${ARGO_DOMAIN}&type=ws&host=${ARGO_DOMAIN}&path=%2Fws#${nodeName}
vmess://${Buffer.from(JSON.stringify({
        v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID,
        aid: '0', scy: 'none', net: 'ws', type: 'none', host: ARGO_DOMAIN, path: '/ws', tls: 'tls'
    })).toString('base64')}
trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${ARGO_DOMAIN}&type=ws&host=${ARGO_DOMAIN}&path=%2Fws#${nodeName}
    `;
    const subPathFull = path.join(FILE_PATH, 'sub.txt');
    fs.writeFileSync(subPathFull, Buffer.from(subTxt).toString('base64'));

    app.get(`/${SUB_PATH}`, (req, res) => {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(Buffer.from(subTxt).toString('base64'));
    });

    if (UPLOAD_URL && PROJECT_URL) {
        try {
            await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, {
                subscription: [`${PROJECT_URL}/${SUB_PATH}`]
            }, { headers: { 'Content-Type': 'application/json' } });
            console.log('订阅上传成功');
        } catch (err) { /* 忽略 */ }
    }
}

// ---------------------------
// 自动访问项目 URL
// ---------------------------
async function addVisitTask() {
    if (!AUTO_ACCESS || !PROJECT_URL) return;
    try {
        await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }, { headers: { 'Content-Type': 'application/json' } });
        console.log('自动访问任务已添加');
    } catch (err) { console.error('自动访问失败', err.message); }
}

// ---------------------------
// 启动顺序
// ---------------------------
async function startServer() {
    try {
        await generateConfig();
        await startXray();
        await startTunnel();
        await generateLinks();
        await addVisitTask();
    } catch (err) {
        console.error('启动错误', err);
    }
}

startServer().catch(console.error);

app.listen(PORT, () => console.log(`HTTP 服务器监听 ${PORT}`));
