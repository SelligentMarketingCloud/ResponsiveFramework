const { configureCreateEmail } = require('@researchgate/emailonacid-snapshot');
const fs = require('fs');

async function run() {

    const clients = fs.readFileSync('clients.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

    const createEmail = configureCreateEmail({
        clients
    });

    const emailContent = fs.readFileSync('../source/latest.html');

    const email = await createEmail(emailContent);

    const actualClients = email.clients;

    const missingClients = clients.filter(client => !actualClients.includes(client));

    if (missingClients.length > 0) {
        console.warn(`Unable to create screenshots for: ${missingClients.join(', ')}`);
    }

    for (const client of actualClients) {
        const screenshot = await email.screenshot(client);

        fs.writeFileSync(`../output/${client}.png`, screenshot);
    }

    // assert screenshot at this point
    await email.clean();
}

run();
