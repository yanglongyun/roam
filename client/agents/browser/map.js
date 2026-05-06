const status = require('./functions/status');
const openTab = require('./functions/open-tab');
const navigate = require('./functions/navigate');
const evaluate = require('./functions/eval');
const attach = require('./functions/attach');
const detach = require('./functions/detach');

module.exports = [
    { name: 'browser_status', type: 'function', execute: status },
    { name: 'browser_open_tab', type: 'function', execute: openTab },
    { name: 'browser_navigate', type: 'function', execute: navigate },
    { name: 'browser_eval', type: 'function', execute: evaluate },
    { name: 'browser_attach', type: 'function', execute: attach },
    { name: 'browser_detach', type: 'function', execute: detach },
];
