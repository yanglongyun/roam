export default {
    CLOUDFLARE_WORKER_URL: 'https://roam.example.workers.dev', // 已部署的 Cloudflare Worker 地址
    DEVICE_TOKEN: '',       // 和 Worker 的 DEVICE_TOKEN secret 一致；不对的话 Worker 不让这台电脑接入
    DEVICE_NAME: '',        // 可选：这台设备的名字，网页和助理里显示；留空用「用户名 的 Mac / 主机名」
    DEVICE_DESCRIPTION: '', // 可选：一句话描述这台设备（干什么用、有什么环境），会进助理的上下文
    // 访问密码在云端：npx wrangler secret put ACCESS_PASSWORD
    // 设备 id 首次启动自动生成，存在 ~/.roam/device.json
};
