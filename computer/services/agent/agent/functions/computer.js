import { saveImage } from '../../images.js';

// 工具只描述一次观察或操作；判断下一步仍由任务的模型循环负责。
export default async function computer(args, config, signal) {
    if (!config.session_id) throw new Error('桌面操作必须属于一个任务');
    if (!config.screen) throw new Error('桌面服务未启动');
    const { action, frame_id: frameId } = args;
    let request;
    if (action === 'screenshot') request = { action: 'capture' };
    else {
        if (typeof frameId !== 'string' || !frameId) throw new Error('操作前必须先截图，并传入截图返回的 frame_id');
        let input;
        if (action === 'click') input = { type: 'click', x: args.x, y: args.y, button: args.button ?? 'left', count: args.count ?? 1 };
        else if (action === 'scroll') input = { type: 'scroll', x: args.x, y: args.y, deltaX: args.delta_x ?? 0, deltaY: args.delta_y ?? 0 };
        else if (action === 'type') input = { type: 'text', text: args.text };
        else if (action === 'key') input = { type: 'key', key: args.key, modifiers: args.modifiers ?? [] };
        else throw new Error('action 必须是 screenshot / click / scroll / type / key');
        request = { action: 'input', frameId, input };
    }
    const shot = await config.screen.perform(`task:${config.session_id}`, request, { signal, pixels: true, captureAfter: true });
    signal?.throwIfAborted();
    const imageURL = await saveImage(config.images_dir, shot.buffer, shot.mime === 'image/png' ? '.png' : '.jpeg', signal);
    config.run_images?.add(imageURL);
    return { text: JSON.stringify({ frame_id: shot.frameId, width: shot.width, height: shot.height,
        captured_at: shot.capturedAt, control: shot.control,
        result: action === 'screenshot' ? '已截图' : '操作已执行，附操作后的截图' }), imageURL };
}
