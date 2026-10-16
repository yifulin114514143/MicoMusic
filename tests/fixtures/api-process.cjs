const http = require('node:http');
if (process.argv.includes('--fail')) {
    process.stderr.write('API fixture startup failed');
    process.exit(7);
}
const port = Number(process.argv.find(arg => arg.startsWith('--port=')).slice(7));
const server = http.createServer((_req, response) => response.end('MicoMusic isolated API'));
server.listen(port, process.env.HOST, () => {
    process.stdout.write('server running @ ');
    setTimeout(() => process.stdout.write(`http://${process.env.HOST}:${port}\n`), 10);
});
