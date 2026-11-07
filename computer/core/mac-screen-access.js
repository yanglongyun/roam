import koffi from 'koffi';

const graphics = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const hasAccess = graphics.func('bool CGPreflightScreenCaptureAccess(void)');
const requestAccess = graphics.func('bool CGRequestScreenCaptureAccess(void)');
let requesting = false;

export function ensureScreenAccess() {
    if (hasAccess()) return;

    // The system dialog belongs to this Mac. Keep the remote page responsive while it is open.
    if (!requesting) {
        requesting = true;
        requestAccess.async((err) => {
            requesting = false;
            if (err) console.error('请求录屏权限失败', err);
        });
    }
    throw new Error('请在这台 Mac 上允许录制屏幕，然后重试。若未出现提示，请在「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」中开启权限。');
}
