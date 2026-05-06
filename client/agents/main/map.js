const terminal = require('./functions/terminal');

module.exports = [
    {
        name: 'terminal',
        type: 'function',
        execute: terminal,
    },
    {
        name: 'browser',
        type: 'agent',
        target: 'browser',
    },
    {
        name: 'playwright',
        type: 'agent',
        target: 'playwright',
    },
];
