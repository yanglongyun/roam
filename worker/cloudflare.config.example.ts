/**
 * 复制这份文件到 `cloudflare.config.ts`,按注释逐项改成你自己的值。
 * `cloudflare.config.ts` 已 gitignore,所有机密只留在本地。
 *
 * 需要准备:
 *   1) Cloudflare account_id
 *        npx cf auth whoami
 *   2) (可选)绑自己的域名 — 先把域名托管进 Cloudflare,再填 domains;
 *        不绑就把整个 domains 段删掉,Worker 会自动给一个
 *        roam.<your-subdomain>.workers.dev 的测试地址。
 *
 * Worker 自身是无状态中继 — 不需要 D1 / R2 / KV 任何存储,也没有 secret。
 * 访问密码校验在本机 Server(server/config.js 的 SESSION_PASSWORD)。
 */
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	accountId: "<YOUR_CLOUDFLARE_ACCOUNT_ID>",
	worker: {
		name: "roam",
		compatibilityDate: "2025-09-12",
		entrypoint: "server/index.js",
		observability: {
			enabled: true,
		},
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: ["/ws"],
		},
		// 不绑自定义域名就把整个 domains 段删掉,Cloudflare 会自动给
		// roam.<your-subdomain>.workers.dev 的测试地址。
		// 要绑自己的域名(如 roam.example.com):
		//   1) 先在 Cloudflare 控制台 → Websites 把域名托管进来
		//   2) 下面换成要绑的域名
		//   3) npm run deploy 之后 Cloudflare 会自动配 DNS + 证书
		domains: ["<YOUR_DOMAIN>"],
		exports: {
			TerminalSessionManager: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			TERMINAL_SESSION_MANAGER: bindings.durableObject({
				worker: "roam",
				exportName: "TerminalSessionManager",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
