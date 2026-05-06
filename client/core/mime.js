const path = require('path');

const MIME_MAP = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/typescript',
    '.tsx': 'text/typescript', '.jsx': 'text/javascript',
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.xml': 'application/xml', '.yml': 'text/yaml', '.yaml': 'text/yaml',
    '.toml': 'text/plain', '.ini': 'text/plain', '.conf': 'text/plain',
    '.sh': 'text/x-shellscript', '.zsh': 'text/x-shellscript', '.bash': 'text/x-shellscript',
    '.py': 'text/x-python', '.rb': 'text/x-ruby', '.go': 'text/x-go',
    '.rs': 'text/x-rust', '.java': 'text/x-java', '.c': 'text/x-c',
    '.cpp': 'text/x-c++', '.h': 'text/x-c', '.hpp': 'text/x-c++',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

function guessMime(name) {
    const ext = path.extname(name).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

function isTextMime(mime) {
    return /^text\//.test(mime)
        || mime.includes('json')
        || mime.includes('javascript')
        || mime.includes('typescript')
        || mime.includes('xml')
        || mime.includes('yaml');
}

module.exports = { guessMime, isTextMime };
