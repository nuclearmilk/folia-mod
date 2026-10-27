// dev/bilibili/devBilibiliProxyPlugin.mjs
// Vite dev proxy providing full Bilibili API and media streaming in browser mode.

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import https from 'https';

const require = createRequire(import.meta.url);
const { createBilibiliApi } = require('../../electron/bilibili/bilibiliApi.cjs');
const { createBilibiliSessionRepository } = require('../../electron/bilibili/session.cjs');

export function devBilibiliProxyPlugin() {
    const sessionFilePath = path.resolve(process.cwd(), '.dev-credentials/bilibili.json');

    const fileStore = {
        get(key) {
            try {
                if (fs.existsSync(sessionFilePath)) {
                    const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));
                    return data[key];
                }
            } catch {}
            return undefined;
        },
        set(key, val) {
            try {
                const dir = path.dirname(sessionFilePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                let data = {};
                if (fs.existsSync(sessionFilePath)) {
                    try { data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8')); } catch {}
                }
                data[key] = val;
                fs.writeFileSync(sessionFilePath, JSON.stringify(data, null, 2));
            } catch {}
        },
        delete(key) {
            try {
                if (fs.existsSync(sessionFilePath)) {
                    const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));
                    delete data[key];
                    fs.writeFileSync(sessionFilePath, JSON.stringify(data, null, 2));
                }
            } catch {}
        },
    };

    const secretKey = crypto.createHash('sha256').update('folia-bilibili-dev-secret').digest();
    const mockSafeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dev-crypto',
        encryptString(plainText) {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', secretKey, iv);
            let encrypted = cipher.update(plainText, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return Buffer.concat([iv, encrypted]).toString('base64');
        },
        decryptString(cipherBuffer) {
            const data = Buffer.isBuffer(cipherBuffer) ? cipherBuffer : Buffer.from(cipherBuffer, 'base64');
            const iv = data.subarray(0, 16);
            const encryptedText = data.subarray(16);
            const decipher = crypto.createDecipheriv('aes-256-cbc', secretKey, iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString('utf8');
        },
    };

    const sessions = createBilibiliSessionRepository({ store: fileStore, safeStorage: mockSafeStorage });
    const api = createBilibiliApi({ sessions });

    return {
        name: 'folia-dev-bilibili-proxy',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const requestUrl = new URL(req.url || '/', 'http://localhost');

                // 1. API endpoint: /api/bilibili
                if (requestUrl.pathname === '/api/bilibili') {
                    if (req.method === 'OPTIONS') {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
                        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                        res.statusCode = 200;
                        res.end();
                        return;
                    }

                    try {
                        let body = {};
                        if (req.method === 'POST') {
                            const chunks = [];
                            for await (const chunk of req) chunks.push(chunk);
                            body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                        } else {
                            body = Object.fromEntries(requestUrl.searchParams.entries());
                        }

                        const { operation, params = {} } = body;
                        const result = await api.request(operation, params);
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Content-Type', 'application/json');
                        res.statusCode = 200;
                        res.end(JSON.stringify(result));
                    } catch (err) {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Content-Type', 'application/json');
                        res.statusCode = 500;
                        res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: String(err) } }));
                    }
                    return;
                }

                // 2. Media / Audio Proxy: /api/bilibili-media
                if (requestUrl.pathname === '/api/bilibili-media') {
                    if (req.method === 'OPTIONS') {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
                        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
                        res.statusCode = 200;
                        res.end();
                        return;
                    }

                    const targetUrl = requestUrl.searchParams.get('url');
                    if (!targetUrl) {
                        res.statusCode = 400;
                        res.end('Missing url');
                        return;
                    }

                    try {
                        const client = targetUrl.startsWith('https') ? https : http;
                        const headers = {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                            'Referer': 'https://www.bilibili.com/',
                        };
                        if (req.headers.range) {
                            headers.range = req.headers.range;
                        }

                        const proxyReq = client.request(targetUrl, { method: req.method, headers }, (proxyRes) => {
                            res.statusCode = proxyRes.statusCode;
                            res.setHeader('Access-Control-Allow-Origin', '*');
                            res.setHeader('Accept-Ranges', 'bytes');
                            for (const [k, v] of Object.entries(proxyRes.headers)) {
                                const lk = k.toLowerCase();
                                if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(lk)) {
                                    res.setHeader(k, v);
                                }
                            }
                            proxyRes.pipe(res);
                        });

                        proxyReq.on('error', (err) => {
                            res.statusCode = 502;
                            res.end(String(err));
                        });
                        proxyReq.end();
                    } catch (err) {
                        res.statusCode = 500;
                        res.end(String(err));
                    }
                    return;
                }

                next();
            });
        },
    };
}
