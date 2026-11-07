// 应用分离回归：共用请求通道，助理 / 任务的消息和运行态互不串页。
// npm run build 后或直接 node tests/apps.mjs；无需启动 Worker 或访问真实账号。
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createSSRApp, h, nextTick } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const originalFetch = globalThis.fetch;
const pinia = createPinia();
setActivePinia(pinia);
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
const item = (text, role = 'user') => ({ type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
const histories = {
    router: [{ id: 1, created_at: 1, item: item('助理独立历史') }],
    'task-0': [{ id: 2, created_at: 1, item: item('任务独立目标') }],
};
const sampleTasks = Array.from({ length: 12 }, (_, index) => ({
    id: `task-${index}`, title: `任务标题 ${index}`, goal: `任务目标 ${index}`, status: index === 0 ? 'running' : 'done',
    progress: `进度 ${index}`, device_id: 'device-test', steps: index, cost: 0,
    updated_at: Date.now() - index * 1000,
}));

try {
    const { useWsStore } = await vite.ssrLoadModule('/src/stores/ws.js');
    const ws = useWsStore();
    const handlers = new Map();
    const requests = [];
    ws.onMessage = (type, fn) => handlers.set(type, fn);
    ws.getAuthToken = () => 'test-token';
    ws.sendMsg = () => { throw new Error('业务请求不应走 WS'); };
    const { matchAgentHttp } = await vite.ssrLoadModule('/shared/agent-http.js');
    let fetchOverride;
    globalThis.fetch = async (url, options) => {
        const parsed = new URL(url, 'http://localhost');
        const { op, params } = matchAgentHttp(parsed.pathname).find(({ method }) => method === options.method);
        const args = { ...Object.fromEntries(parsed.searchParams), ...(options.body ? JSON.parse(options.body) : {}), ...params };
        for (const key of ['limit', 'before']) if (args[key]) args[key] = Number(args[key]);
        requests.push({ op, args, method: options.method, url });
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        if (fetchOverride) {
            const override = fetchOverride(op, args, options);
            if (override) return override;
        }
        let data;
        if (op === 'status.get') data = { model_ready: true, model: 'test-model', images: false };
        else if (op === 'router.open') data = { id: 'router', title: '助理' };
        else if (op === 'tasks.dispatch') data = { task_id: 'manual-task' };
        else if (op === 'tasks.patch') {
            const current = sampleTasks.find((entry) => entry.id === args.id);
            current.title = args.title;
            data = { task: { ...current } };
        }
        else if (op === 'sessions.open') data = { messages: histories[args.id] || [], compactions: [], has_more: false, running: args.id === 'task-0' };
        else if (op === 'tasks.list') data = { tasks: sampleTasks };
        else if (op === 'messages.list') data = { messages: [{id:1,created_at:1,item:item('更早的任务消息')}], has_more:false };
        else if (op === 'messages.send') data = { id: 100, created_at: Date.now() };
        else if (op === 'run.stop') data = { stopped: true };
        else throw new Error(`Unexpected operation: ${op}`);
        return Response.json({ ok: true, data });
    };
    ws.state = 'connected';
    ws.authenticated = true;
    const { useAssistantStore, useTaskAgentStore } = await vite.ssrLoadModule('/src/stores/agent.js');
    const { useTasksStore } = await vite.ssrLoadModule('/src/stores/tasks.js');
    const { useViewStore } = await vite.ssrLoadModule('/src/stores/view.js');
    const assistant = useAssistantStore();
    const { useAgentClientStore } = await vite.ssrLoadModule('/src/stores/agent-client.js');
    const client = useAgentClientStore();
    const task = useTaskAgentStore();
    const tasks = useTasksStore();
    const view = useViewStore();
    assistant.init();
    task.init();
    tasks.init();
    await new Promise((resolve) => setTimeout(resolve, 20));

    check('应用面板保留助理和任务，移除独立对话入口', () => {
        assert.deepEqual(view.apps.slice(0, 2).map(({ label }) => label), ['助理', '任务']);
        assert.ok(!view.apps.some(({ label, path }) => label === '对话' || path === '/chat'));
        assert.equal(view.appOf('/tasks/task-0').label, '任务');
        assert.equal(view.appOf('/assistant').side, undefined);
        assert.equal(view.appOf('/chat'), null);
    });
    check('打开助理自动进入常驻会话', () => assert.equal(assistant.currentId, 'router'));
    await tasks.open(sampleTasks[0]);
    check('打开任务不覆盖助理', () => {
        assert.equal(task.currentId, 'task-0');
        assert.equal(assistant.currentId, 'router');
        assert.equal(task.currentTask.id, 'task-0');
        assert.equal(assistant.currentTask, null);
    });
    const event = (value) => handlers.get('agent.event')({ data: value });
    event({ session_id: 'task-0', type: 'message', delta: '任务正在执行' });
    check('任务流式内容只进入任务页面', () => {
        assert.equal(task.busy, true);
        assert.equal(assistant.busy, false);
        assert.equal(assistant.messages.length, 1);
    });
    const { buildRows } = await vite.ssrLoadModule('/src/lib/agent/thread.js');
    event({ session_id: 'router', type: 'message', id: 77, created_at: Date.now(),
        item: item('[任务状态通知]\n{"result":"内部结果"}'), notification_id: 'notice-1',
        task_id: 'task-0', task_status: 'done', task_title: '自动完成的任务' });
    check('任务通知显示为带任务来源的系统提示', () => {
        const row = buildRows(assistant.messages).find((entry) => entry.code === 'task_notification');
        assert.equal(row.kind, 'system');
        assert.equal(row.taskId, 'task-0');
        assert.match(row.content, /任务已完成/);
        assert.equal(row.content, '任务已完成：自动完成的任务');
        assert.doesNotMatch(row.content, /内部结果/);
    });
    event({ session_id: 'router', type: 'task_report', status: 'completed', task_ids: ['task-0'] });
    check('在其他应用时主动汇报有未读提示，打开助理后清除', () => {
        assert.equal(assistant.unread, 1);
        assistant.setVisible(true);
        assert.equal(assistant.unread, 0);
        assistant.setVisible(false);
    });
    event({ session_id: 'router', type: 'message', delta: '助理正在回复' });
    event({ session_id: 'task-0', type: 'done', status: 'completed' });
    check('任务结束不停止助理回复', () => {
        assert.equal(task.busy, false);
        assert.equal(assistant.busy, true);
    });
    event({ session_id: 'router', type: 'done', status: 'completed' });
    await Promise.all([assistant.loadStatus(), task.loadStatus(), client.loadStatus()]);
    check('助理和任务通过同一通道并发请求，结果不串', () => {
        assert.ok(requests.filter(({ op }) => op === 'status.get').every(({ method }) => method === 'GET'));
        assert.equal(assistant.status.model, 'test-model');
        assert.equal(task.status.model, 'test-model');
    });
    check('设置更新的模型状态在助理和任务同步', () => {
        client.status = { model_ready: true, model: 'updated-model', images: false };
        assert.equal(assistant.status.model, 'updated-model');
        assert.equal(task.status.model, 'updated-model');
    });
    check('助理发言始终发送到助理会话', () => {
        assert.equal(assistant.send('安排下一件事'), true);
        assert.equal(requests.at(-1).args.id, 'router');
    });
    await nextTick();
    check('任务追加指令始终发送到任务会话', () => {
        task.busy = true;
        assert.equal(task.send('继续任务'), true);
        assert.equal(requests.at(-1).args.id, 'task-0');
    });
    await nextTick();
    await task.stopRun();
    check('任务停止请求不会停止助理', () => {
        assert.equal(requests.at(-1).op, 'run.stop');
        assert.equal(requests.at(-1).args.id, 'task-0');
        assert.equal(assistant.busy, true);
    });
    const manualArgs = { title: '手动任务标题', goal: '手动创建目标', device: 'device-test', workdir: '/tmp/manual', budget: { steps: 5 } };
    const manualId = await tasks.create(manualArgs);
    check('手动创建走任务接口，标题和完整目标分别提交', () => {
        assert.equal(manualId, 'manual-task');
        assert.deepEqual(requests.find(({ op }) => op === 'tasks.dispatch').args, manualArgs);
        assert.ok(!requests.some(({ op }) => op === 'sessions.create' || op === 'sessions.list'));
        assert.equal(assistant.currentId, 'router');
        assert.equal(task.currentId, 'task-0');
    });
    await tasks.rename(sampleTasks[0], '改过的短标题');
    check('修改标题只更新任务名称，不修改目标和历史', () => {
        assert.equal(task.currentTask.title, '改过的短标题');
        assert.equal(task.currentTask.goal, '任务目标 0');
        assert.equal(task.messages[0].item.content[0].text, '任务独立目标');
        assert.deepEqual(requests.find(({ op }) => op === 'tasks.patch').args, { id: 'task-0', title: '改过的短标题' });
    });
    assistant.drafts.router = '助理自己的草稿';
    task.drafts['task-0'] = '任务自己的草稿';
    await task.openTask(sampleTasks[1]);
    await task.openTask(sampleTasks[0]);
    check('任务切换后保留各自草稿，助理草稿独立', () => {
        assert.equal(task.drafts['task-0'], '任务自己的草稿');
        assert.equal(task.drafts.router, undefined);
        assert.equal(assistant.drafts.router, '助理自己的草稿');
    });
    ws.state = 'offline';
    await nextTick();
    ws.state = 'connected';
    await new Promise((resolve) => setTimeout(resolve, 20));
    check('重新连接分别恢复助理和任务会话', () => {
        assert.equal(assistant.currentId, 'router');
        assert.equal(task.currentId, 'task-0');
        assert.equal(assistant.messages[0].item.content[0].text, '助理独立历史');
        assert.equal(task.messages[0].item.content[0].text, '任务独立目标');
    });

    let resolveOpen;
    fetchOverride = (op) => op === 'sessions.open' ? new Promise((resolve) => { resolveOpen = resolve; }) : null;
    const reopening = task.openThread('task-0', true);
    const cursor = (sequence) => ({ epoch: 'test-epoch', sequence });
    event({ session_id:'task-0', type:'message', delta:'快照内的前半段', event_cursor:cursor(10) });
    event({ session_id:'task-0', type:'message', delta:'后半段', event_cursor:cursor(11) });
    resolveOpen(Response.json({ok:true, data:{messages:histories['task-0'],compactions:[],has_more:true,running:true,
        streaming:{text:'快照内的前半段',reasoning:''},event_cursor:cursor(10)}}));
    await reopening;
    check('HTTP 快照期间的流式事件按游标合并，不重复、不丢字', () => {
        assert.equal(task.messages.find((m) => m.streaming).item.content[0].text, '快照内的前半段后半段');
    });
    fetchOverride = null;
    event({session_id:'task-0',type:'reasoning',delta:'独立思考'});
    ws.state = 'offline';
    await nextTick();
    await task.loadOlder();
    check('WS 断线或回复中，仍可 HTTP 分页且保留全部流式占位', () => {
        assert.equal(requests.at(-1).op,'messages.list');
        assert.equal(requests.at(-1).method,'GET');
        assert.match(requests.at(-1).url,/before=2/);
        assert.equal(task.messages.filter((m) => m.streaming).length,2);
        assert.equal(task.messages[0].item.content[0].text,'更早的任务消息');
    });
    ws.state = 'connected';
    await new Promise((resolve) => setTimeout(resolve, 20));
    fetchOverride = (op) => op === 'sessions.open' ? new Promise((resolve) => { resolveOpen = resolve; }) : null;
    const racedDone = task.openThread('task-0', true);
    event({session_id:'task-0',type:'message',delta:'最终结果',event_cursor:cursor(21)});
    event({session_id:'task-0',type:'message',id:300,created_at:1,item:item('最终结果','assistant'),event_cursor:cursor(22)});
    event({session_id:'task-0',type:'done',status:'completed',event_cursor:cursor(23)});
    resolveOpen(Response.json({ok:true,data:{messages:[...histories['task-0'],{id:300,created_at:1,item:item('最终结果','assistant')}],
        compactions:[],has_more:false,running:true,streaming:{text:'',reasoning:''},event_cursor:cursor(20)}}));
    await racedDone;
    check('HTTP 返回前任务已完成，结果不重复，运行态不会被旧快照覆盖', () => {
        assert.equal(task.busy,false);
        assert.equal(task.messages.filter((m) => m.id === 300).length,1);
        assert.equal(task.messages.filter((m) => m.streaming).length,0);
    });
    fetchOverride = null;
    await task.openTask(sampleTasks[0]);

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] });
    await router.push('/tasks');
    const render = async (component, props = {}) => {
        const app = createSSRApp({ render: () => h(component, props) });
        app.use(pinia);
        app.use(router);
        return renderToString(app);
    };
    const { default: TasksView } = await vite.ssrLoadModule('/src/views/TasksView.vue');
    const tasksHtml = await render(TasksView);
    check('任务应用显示完整列表、筛选和独立详情入口', () => {
        assert.match(tasksHtml, /任务标题 11/);
        assert.doesNotMatch(tasksHtml, /任务目标 11/);
        assert.match(tasksHtml, /进行中/);
        assert.match(tasksHtml, /等人决定/);
        assert.match(tasksHtml, /查看任务/);
        assert.match(tasksHtml, /新建任务/);
        assert.doesNotMatch(tasksHtml, /旧对话|助理独立历史/);
    });
    const { default: NewTaskModal } = await vite.ssrLoadModule('/src/components/tasks/NewTaskModal.vue');
    const modalHtml = await render(NewTaskModal, { open: true });
    check('新建任务表单区分标题与目标，保留设备和执行上限', () => {
        assert.match(modalHtml, /任务标题/);
        assert.match(modalHtml, /任务目标/);
        assert.match(modalHtml, /执行设备/);
        assert.match(modalHtml, /工作目录/);
        assert.match(modalHtml, /步数上限/);
        assert.match(modalHtml, /助理会主动汇报/);
    });
    const { default: ConversationPane } = await vite.ssrLoadModule('/src/components/agent/ConversationPane.vue');
    const assistantHtml = await render(ConversationPane, { agent: assistant });
    const taskHtml = await render(ConversationPane, { agent: task, task: true });
    check('助理与任务渲染各自消息和输入框', () => {
        assert.match(assistantHtml, /助理独立历史/);
        assert.match(assistantHtml, /告诉助理要做什么/);
        assert.doesNotMatch(assistantHtml, /任务独立目标|task-bar/);
        assert.match(taskHtml, /任务独立目标/);
        assert.match(taskHtml, /给这个任务追加指令/);
        assert.match(taskHtml, /task-bar/);
        assert.doesNotMatch(taskHtml, /助理独立历史/);
    });
    const { default: TaskTitle } = await vite.ssrLoadModule('/src/components/tasks/TaskTitle.vue');
    const heading = await render(TaskTitle, { task: sampleTasks[0] });
    check('任务标题使用独立名称，不展示目标正文，并可直接编辑', () => {
        assert.match(heading, /改过的短标题/);
        assert.match(heading, /修改任务标题/);
        assert.doesNotMatch(heading, /任务目标 0|任务 · /);
    });
    tasks.tasks = tasks.tasks.map((entry) => entry.id === 'task-0' ? { ...entry, status: 'done', progress: '完整的结束结果不应重复显示在状态栏' } : entry);
    const completedTask = await render(ConversationPane, { agent: task, task: true });
    check('已结束任务的状态栏不复述目标或完整结果', () => {
        assert.match(completedTask, /已完成/);
        assert.doesNotMatch(completedTask, /完整的结束结果不应重复显示在状态栏|任务目标 0/);
    });
    console.log(`\n${checks} 项检查全部通过`);
} finally {
    globalThis.fetch = originalFetch;
    disposePinia(pinia);
    await vite.close();
}
