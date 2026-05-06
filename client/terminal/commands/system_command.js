const sessions = require('../core/sessions');

async function run(command, terminalId) {
    const terminal = sessions.get(terminalId);
    switch (command) {
        case 'restart':
            if (!terminal) return;
            console.log(`🔄 重启终端进程 ${terminal.id}...`);
            await sessions.restart(terminal.id);
            break;
        case 'clear':
            terminal?.ptyProcess?.write('\x1b[2J\x1b[H');
            break;
        case 'ctrl_c':
            terminal?.ptyProcess?.write('\x03');
            break;
        default:
            console.log('未知系统命令:', command);
    }
}

module.exports = { run };
