import pty from 'node-pty';
import path from 'path';
import ws from '../../../server/ws.js';
import { generateTerminalId } from '../../../core/ids.js';
import { getDefaultShell, ensureDirectory, getDefaultDirectory } from './shell.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 30;

const terminals = new Map();
let activeId = null;

function getMeta(terminal) {
    return {
        id: terminal.id,
        title: terminal.title,
        cwd: terminal.cwd,
        cols: terminal.cols,
        rows: terminal.rows,
        createdAt: terminal.createdAt,
        isActive: terminal.id === activeId,
    };
}

function broadcastList(target = 'web') {
    const payload = {
        terminals: list(),
        activeTerminalId: activeId,
    };
    if (target === 'web') ws.broadcast('terminal.list', payload);
    else ws.send({ type: 'terminal.list', to: target, data: payload });
}

function broadcastCreated(terminal) {
    ws.broadcast('terminal.created', {
        terminal: getMeta(terminal),
        activeTerminalId: activeId,
    });
}

function broadcastClosed(terminalId) {
    ws.broadcast('terminal.closed', {
        terminalId,
        activeTerminalId: activeId,
    });
}

function broadcastActivated(terminalId) {
    ws.broadcast('terminal.activated', { terminalId });
}

function broadcastInit(terminal, target = 'web') {
    const payload = {
        terminalId: terminal.id,
        cols: terminal.cols,
        rows: terminal.rows,
    };
    if (target === 'web') ws.broadcast('system.init', payload);
    else ws.send({ type: 'system.init', to: target, data: payload });
}

function broadcastError(error, terminalId = null) {
    ws.broadcast('terminal.error', { terminalId, error });
}

function attachPty(terminal, ptyProcess) {
    terminal.ptyProcess = ptyProcess;

    ptyProcess.onData((data) => {
        if (terminal.ptyProcess !== ptyProcess) return;
        ws.broadcast('data.output', { terminalId: terminal.id, output: data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
        if (terminal.ptyProcess !== ptyProcess) return;
        console.log(`终端 ${terminal.id} 退出: code ${exitCode}, signal ${signal}`);
        if (!terminals.has(terminal.id)) return;
        close(terminal.id, { ensureOne: terminals.size <= 1 }).catch((err) => {
            console.error('关闭退出终端失败:', err.message);
        });
    });
}

async function create(options = {}) {
    const cwd = await ensureDirectory(options.cwd);
    const id = options.terminalId || generateTerminalId();
    if (terminals.has(id)) return terminals.get(id);

    const cols = options.cols || DEFAULT_COLS;
    const rows = options.rows || DEFAULT_ROWS;
    const shell = getDefaultShell();
    const terminal = {
        id,
        title: options.title || path.basename(cwd) || cwd || 'Terminal',
        cwd,
        cols,
        rows,
        createdAt: Date.now(),
        ptyProcess: null,
    };

    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color', cols, rows, cwd, env: process.env,
    });
    attachPty(terminal, ptyProcess);

    terminals.set(id, terminal);
    activeId = id;
    broadcastCreated(terminal);
    broadcastInit(terminal);
    return terminal;
}

function get(terminalId) {
    if (terminalId && terminals.has(terminalId)) return terminals.get(terminalId);
    if (activeId && terminals.has(activeId)) return terminals.get(activeId);
    return terminals.values().next().value || null;
}

function list() {
    return [...terminals.values()].map(getMeta);
}

function getActiveId() {
    return activeId;
}

function activate(terminalId) {
    const terminal = get(terminalId);
    if (!terminal) return null;
    activeId = terminal.id;
    broadcastActivated(terminal.id);
    broadcastInit(terminal);
    return terminal;
}

async function close(terminalId, options = {}) {
    const terminal = get(terminalId);
    if (!terminal) return;
    terminals.delete(terminal.id);
    if (activeId === terminal.id) {
        activeId = terminals.keys().next().value || null;
    }
    terminal.ptyProcess?.kill();
    broadcastClosed(terminal.id);

    if (!terminals.size && options.ensureOne) {
        const created = await create({ cwd: getDefaultDirectory() });
        broadcastActivated(created.id);
        return;
    }

    if (activeId) {
        broadcastActivated(activeId);
        const active = get(activeId);
        if (active) broadcastInit(active);
    }
}

function write(terminalId, input) {
    const terminal = get(terminalId);
    if (terminal && input) terminal.ptyProcess?.write(input);
}

function resize(terminalId, cols, rows) {
    const terminal = get(terminalId);
    if (!terminal || !cols || !rows) return;
    terminal.cols = cols;
    terminal.rows = rows;
    terminal.ptyProcess?.resize(cols, rows);
}

async function restart(terminalId) {
    const terminal = get(terminalId);
    if (!terminal) return;
    terminal.ptyProcess?.kill();

    const shell = getDefaultShell();
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: terminal.cols,
        rows: terminal.rows,
        cwd: terminal.cwd,
        env: process.env,
    });
    attachPty(terminal, ptyProcess);

    broadcastInit(terminal);
    console.log(`✅ 终端 ${terminal.id} 已重启`);
}

function killAll() {
    for (const terminal of terminals.values()) {
        terminal.ptyProcess?.kill();
    }
}

export { create, get, list, activate, close, write, resize, restart, killAll, getActiveId, getMeta, broadcastList, broadcastInit, broadcastError };
export default {
    create, get, list, activate, close, write, resize, restart, killAll,
    getActiveId, getMeta,
    broadcastList, broadcastInit, broadcastError,
};