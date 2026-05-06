const { request } = require('./request');

module.exports = async function status() {
    return request('/state');
};
