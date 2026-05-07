import status from './functions/status.js';
import openTab from './functions/open-tab.js';
import navigate from './functions/navigate.js';
import evaluate from './functions/eval.js';
import attach from './functions/attach.js';
import detach from './functions/detach.js';

export default [
    { name: 'browser_status', type: 'function', execute: status },
    { name: 'browser_open_tab', type: 'function', execute: openTab },
    { name: 'browser_navigate', type: 'function', execute: navigate },
    { name: 'browser_eval', type: 'function', execute: evaluate },
    { name: 'browser_attach', type: 'function', execute: attach },
    { name: 'browser_detach', type: 'function', execute: detach },
];
