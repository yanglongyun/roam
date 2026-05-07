import terminal from './functions/terminal.js';

export default [
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
