export default {
    CLOUDFLARE_WORKER_URL: 'https://roam.example.workers.dev', // 已部署的 Cloudflare Worker 地址
    SESSION_ID: '',         // 固定连接会话 ID；留空则每次启动随机生成，不能写 default
    SESSION_PASSWORD: '',   // 远程网页访问密码；留空则不需要登录校验
    DEBUG: '0',             // 调试日志开关；写 1 会打印 WebSocket 收包摘要
};
