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
const PORT = process.env.PORT || 3000; // Claw 专用，必须监听这个端口

const UUID = process.env.UUID;
const ARGO_DOMAIN = process.env.ARGO_DOMAIN;
const ARGO_AUTH = process.env.ARGO_AUTH;
const NAME = process.env.NAME || '';
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;

// ---------------------------
// UUID 必须存在
// ---------------------------
if (!UUID) {
    console.error("❌ 严重错误: 环境变量 UUID 缺失！");
    process.exit(1);
}

// ---------------------------
// 创建文件夹
// ---------------------------
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

// ---------------------------
// 生成 Xray 配置（Claw 可用版）
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
// 下载并运行二进制（cloudflared + xray）
// ---------------------------
async function downloadAndRun() {
    const webPath = path.join(FILE_PATH, 'web');
    const botPath = path.join(FILE_PATH, 'bot');

    // 这里只做演示，假设二进制已经在 FILE_PATH 下
    // 运行 Xray
    await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
    console.log('Xray WS 正在运行');

    // 运行 cloudflared
    if (ARGO_AUTH && ARGO_DOMAIN) {
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://127.0.0.1:${PORT} run --token ${ARGO_AUTH}`;
        await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
        console.log('cloudflared 隧道正在运行');
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
    const subPath = path.join(FILE_PATH, 'sub.txt');
    fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
    console.log('订阅文件生成完成');

    // Express 路由
    app.get(`/${SUB_PATH}`, (req, res) => {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(Buffer.from(subTxt).toString('base64'));
    });

    // 上传节点（可选）
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
// 主逻辑
// ---------------------------
async function startServer() {
    try {
        await generateConfig();
        await downloadAndRun();
        await generateLinks();
        await addVisitTask();
    } catch (err) {
        console.error('启动错误', err);
    }
}

startServer().catch(console.error);

app.listen(PORT, () => console.log(`HTTP 服务器监听 ${PORT}`));
