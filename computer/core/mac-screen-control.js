import koffi from 'koffi';
import { runFile } from './screenshot.js';

const graphics = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const services = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
const foundation = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
const Point = koffi.struct('RoamScreenPoint', { x: 'double', y: 'double' });
const Size = koffi.struct('RoamScreenSize', { width: 'double', height: 'double' });
const Rect = koffi.struct('RoamScreenRect', { origin: Point, size: Size });
const mainDisplay = graphics.func('uint32_t CGMainDisplayID(void)');
const displayBounds = graphics.func('CGDisplayBounds', Rect, ['uint32_t']);
const trusted = services.func('bool AXIsProcessTrusted(void)');
const trustedWithOptions = services.func('bool AXIsProcessTrustedWithOptions(void *options)');
const dictionary = foundation.func('void *CFDictionaryCreateMutable(void *allocator, long capacity, void *keys, void *values)');
const setValue = foundation.func('void CFDictionarySetValue(void *dictionary, void *key, void *value)');
const release = foundation.func('void CFRelease(void *value)');
const mouse = graphics.func('CGEventCreateMouseEvent', 'void *', ['void *', 'uint32_t', Point, 'uint32_t']);
const keyboard = graphics.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)');
const unicode = graphics.func('void CGEventKeyboardSetUnicodeString(void *event, unsigned long length, _In_ uint16_t *text)');
const flags = graphics.func('void CGEventSetFlags(void *event, uint64_t flags)');
const field = graphics.func('void CGEventSetIntegerValueField(void *event, uint32_t field, int64_t value)');
const location = graphics.func('CGEventSetLocation', 'void', ['void *', Point]);
const scroll = graphics.func('void *CGEventCreateScrollWheelEvent2(void *source, uint32_t units, uint32_t count, int32_t y, int32_t x, int32_t z)');
const post = graphics.func('void CGEventPost(uint32_t tap, void *event)');
const keys = {
    Enter: 36, Tab: 48, Space: 49, Backspace: 51, Escape: 53, Delete: 117,
    ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
    Home: 115, End: 119, PageUp: 116, PageDown: 121,
    a: 0, c: 8, v: 9, x: 7, z: 6,
};
const modifierFlags = { shift: 1 << 17, ctrl: 1 << 18, alt: 1 << 19, meta: 1 << 20 };

export function screenDisplay() {
    const id = mainDisplay();
    const bounds = displayBounds(id);
    return { id, x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height };
}
export function controlStatus() { return { supported: true, allowed: trusted(), platform: 'darwin' }; }
export async function requestControlPermission() {
    const options = dictionary(null, 0, null, null);
    try {
        setValue(options, koffi.decode(services.symbol('kAXTrustedCheckOptionPrompt'), 'void *'),
            koffi.decode(foundation.symbol('kCFBooleanTrue'), 'void *'));
        trustedWithOptions(options);
    } finally { release(options); }
    await runFile('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility']);
    return controlStatus();
}
function deliver(event, configure) {
    if (!event) throw new Error('无法创建输入事件');
    try { configure?.(event); post(0, event); } finally { release(event); }
}
function press(code, modifiers = []) {
    const value = modifiers.reduce((sum, key) => sum | modifierFlags[key], 0);
    deliver(keyboard(null, code, true), (event) => flags(event, value));
    deliver(keyboard(null, code, false), (event) => flags(event, value));
}
export function applyInput(action, display) {
    if (!trusted()) throw Object.assign(new Error('请在这台 Mac 的系统设置中允许 Roam Computer 控制电脑。'), { code: 'CONTROL_PERMISSION' });
    if (action.type === 'key') { press(keys[action.key], action.modifiers); return; }
    if (action.type === 'text') {
        // 按 UTF-16 长度分块，不能拆开 emoji 的代理对。
        const chunks = [];
        let chunk = '';
        for (const character of action.text) {
            if (chunk.length + character.length > 20) { chunks.push(chunk); chunk = ''; }
            chunk += character;
        }
        if (chunk) chunks.push(chunk);
        for (const text of chunks) {
            const bytes = Buffer.from(text, 'utf16le');
            const units = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
            deliver(keyboard(null, 0, true), (event) => unicode(event, units.length, units));
            deliver(keyboard(null, 0, false), (event) => unicode(event, units.length, units));
        }
        return;
    }
    const point = { x: display.x + action.x * (display.width - 1), y: display.y + action.y * (display.height - 1) };
    deliver(mouse(null, 5, point, 0));
    if (action.type === 'scroll') {
        // 投递鼠标移动后系统仍可能尚未更新指针位置，滚动事件必须明确使用本次目标。
        deliver(scroll(null, 0, 2, -Math.round(action.deltaY), -Math.round(action.deltaX), 0), (event) => location(event, point));
        return;
    }
    const right = action.button === 'right';
    for (let count = 1; count <= action.count; count++) {
        deliver(mouse(null, right ? 3 : 1, point, right ? 1 : 0), (event) => field(event, 1, count));
        deliver(mouse(null, right ? 4 : 2, point, right ? 1 : 0), (event) => field(event, 1, count));
    }
}
