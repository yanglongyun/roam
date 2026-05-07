export default {
    MEEM_URL: 'https://meem.example.workers.dev', // 已部署的 Worker 地址，可用 workers.dev 或自定义域名
    SESSION_ID: '', // 固定连接会话 ID；留空则每次启动随机生成，不能写 default
    SESSION_PASSWORD: '', // 远程网页访问密码；留空则不需要登录校验
    PLAYWRIGHT_BROWSER_CHANNEL: 'chrome', // Playwright 独立浏览器通道，常用值 chrome / msedge / chromium；旧 BROWSER_CHANNEL 仍兼容
    CHROME_EXTENSION_HOST: '127.0.0.1', // 本地浏览器扩展 bridge 监听地址，通常不用改
    CHROME_EXTENSION_PORT: '17373', // 本地浏览器扩展 bridge 监听端口，需和扩展弹窗里的端口一致
    MEEM_DEBUG: '0', // 调试日志开关；写 1 会打印 WebSocket 收包摘要
};
