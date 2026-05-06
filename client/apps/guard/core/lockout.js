const GLOBAL_MAX_FAILS = 10;
const LOCKOUT_MS = 30 * 60_000;

const state = {
    failCount: 0,
    lockoutUntil: 0,
};

function isLocked() {
    if (state.lockoutUntil && Date.now() >= state.lockoutUntil) {
        state.lockoutUntil = 0;
        state.failCount = 0;
    }
    return state.lockoutUntil > 0;
}

function remainingMinutes() {
    const ms = state.lockoutUntil - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 60_000);
}

function recordFailure() {
    state.failCount += 1;
    if (state.failCount >= GLOBAL_MAX_FAILS) {
        state.lockoutUntil = Date.now() + LOCKOUT_MS;
        console.warn(`🚫 密码失败 ${state.failCount} 次，认证锁定 ${LOCKOUT_MS / 60_000} 分钟`);
        return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: GLOBAL_MAX_FAILS - state.failCount };
}

function reset() {
    state.failCount = 0;
    state.lockoutUntil = 0;
}

module.exports = { isLocked, remainingMinutes, recordFailure, reset };
