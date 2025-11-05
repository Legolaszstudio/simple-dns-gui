const fastify = require('fastify')({ logger: false });
const tslog = require('tslog');
const logger = new tslog.Logger();
const fs = require('fs');
const DNSMASQ_FILE = "./example.hosts";

fastify.addHook('onSend', (request, reply, payload, done) => {
    logger.info(`${request.method} ${request.url} - ${reply.statusCode}`);
    done();
});

fastify.setErrorHandler(function (error, request, reply) {
    // Log error
    logger.error(error);
    Sentry.captureException(error);

    const errorResponse = {
        message: error.message,
        error: error.error,
        statusCode: error.statusCode || 500
    };

    reply.code(errorResponse.statusCode).send(errorResponse);
});

function reloadDnsmasq() {
    // send SIGHUP to dnsmasq process to reload config
    const { exec } = require('child_process');
    exec('pkill -HUP dnsmasq', (error, stdout, stderr) => {
        if (error) {
            logger.error(`Error reloading dnsmasq: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`stderr: ${stderr}`);
            return;
        }
        logger.info(`dnsmasq reloaded: ${stdout}`);
    });
}

// Declare a route
fastify.get('/', function handler(request, reply) {
    const index = fs.readFileSync('./index.html', 'utf8');
    reply.type('text/html').send(index);
});

fastify.post('/get-hosts', async function (request, reply) {
    const hosts = fs.readFileSync(DNSMASQ_FILE, 'utf8');
    const lines = hosts.split('\n').filter(line => line.trim() !== '');
    let id = 0;
    const data = lines.map(line => {
        const [ip, hostname] = line.split(/\s+/);
        return { id: id++, ip, hostname };
    });
    return { data };
});

fastify.post('/add-host', async function (request, reply) {
    const { ip, hostname } = request.body;
    const entry = `${ip} ${hostname}\n`;
    fs.appendFileSync(DNSMASQ_FILE, entry, 'utf8');
    reloadDnsmasq();
    return { message: 'Host added successfully' };
});

fastify.post('/delete-host', async function (request, reply) {
    const { id } = request.body;
    const hosts = fs.readFileSync(DNSMASQ_FILE, 'utf8');
    const lines = hosts.split('\n').filter(line => line.trim() !== '');
    if (id < 0 || id >= lines.length) {
        reply.code(400).send({ message: 'Invalid ID' });
        return;
    }
    lines.splice(id, 1);
    fs.writeFileSync(DNSMASQ_FILE, lines.join('\n') + '\n', 'utf8');
    reloadDnsmasq();
    return { message: 'Host deleted successfully' };
});

fastify.post('/edit-host', async function (request, reply) {
    const { id, ip, hostname } = request.body;
    const hosts = fs.readFileSync(DNSMASQ_FILE, 'utf8');
    const lines = hosts.split('\n').filter(line => line.trim() !== '');
    if (id < 0 || id >= lines.length) {
        reply.code(400).send({ message: 'Invalid ID' });
        return;
    }
    lines[id] = `${ip} ${hostname}`;
    fs.writeFileSync(DNSMASQ_FILE, lines.join('\n') + '\n', 'utf8');
    reloadDnsmasq();
    return { message: 'Host edited successfully' };
});

// Run the server!
fastify.listen({ host: '0.0.0.0', port: 3000 }, (err) => {
    if (err) {
        logger.error(err);
        process.exit(1);
    } else {
        logger.info('Server listening on http://0.0.0.0:3000');
    }
})