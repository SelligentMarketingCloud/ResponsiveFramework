const fs = require('fs');

function getClients(path = 'clients.txt') {
    return fs.readFileSync(path, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
}

function getContent() {
    return fs.readFileSync('../source/latest.html', 'utf-8');
}

module.exports = { getClients, getContent };
