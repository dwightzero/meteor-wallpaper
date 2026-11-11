// Minimal static server used only for development screenshots.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const port = Number(process.argv[3] || 8777);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(root, rel);
  if (!file.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port));
