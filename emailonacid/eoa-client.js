const { getClients } = require('./eoa-config');
const { configureCreateEmail } = require('@researchgate/emailonacid-snapshot');
const createClient = require('@researchgate/emailonacid-client');
const fs = require('fs');
const path = require('path');
const { time } = require('console');

const retries = 3;
const batchSize = 10;

class EoaClient {
    constructor(config = {}) {
        this.config = config;
    }

    async collectScreenshots(emailContent) {

        const requestClients = this.config.clients ?? getClients(this.config.clientsPath);
        const basePath = this.config.basePath ?? '../output/';

        const emailClient = createClient({
            apiKey: this.config.apiKey,
            accountPassword: this.config.accountPassword,
            defaultClients: requestClients,
            poll: {
                timeout: 120000,
            }
        })

        const availableClients = (await emailClient.getClients())
            .filter(({ id }) =>
                requestClients.includes(id));

        console.log(`${availableClients.length}/${requestClients.length} clients available`);

        const clientAttempts = availableClients
            .map(({ id }) => ({
                client: id,
                retries: 0,
                success: false
            }));

        while (clientAttempts.some(ca =>
                !ca.success && ca.retries < retries)) {


            const clientsToDo = clientAttempts
                .filter(ca =>
                    !ca.success && ca.retries < retries);

            const email = await configureCreateEmail({
                clients: clientsToDo.map(ca => ca.client),
                credentials: {
                    apiKey: this.config.apiKey,
                    accountPassword: this.config.accountPassword
                },
                debug: true,
                plugins: [
                    { 
                        name: 'limits',
                        convert: (context) => {
                            context.stream.setMaxListeners(requestClients.length * 2);
                        },
                    }
                ]
            })(emailContent);

            const results = await Promise.all(
                clientsToDo.map(async ({ client, retries, success }) => {

                    try {
                        const screenshot = await email.screenshot(client);
                        const imagePath = path.join(basePath, `${client}.png`);

                        fs.writeFileSync(imagePath, screenshot);

                        success = true;
                    } catch (e) {
                        retries += 1;
                        console.error(`Error creating screenshot for ${client}: ${e.message}`);
                    }

                    return { client, retries, success };
                }
            ));

            try {
                email.clean();
            } catch (e) {
                console.error(`Error cleaning email`);
            }

            for (const result of results) {
                const clientAttempt = clientAttempts.find(ca =>
                    ca.client === result.client);
                clientAttempt.retries = result.retries;
                clientAttempt.success = result.success;
            }
        }

        const result = {
            success: clientAttempts.filter(ca =>
                ca.success).map(ca => ca.client),
            failed: clientAttempts.filter(ca =>
                !ca.success).map(ca => ca.client),
            skipped: requestClients.filter(client =>
                availableClients.find(({ id }) => id === client) === undefined),
        }

        const successString = result.success.map(client =>
            ` ✅ ${client}\n`).join('\n');
        console.log(`${result.success.length} successful screenshots:\n${successString}`);

        if (result.skipped.length > 0) {
            const skippedString = result.skipped.map(client =>
                ` ⚠️ ${client}\n`).join('\n');
            console.warn(`${result.skipped.length} skipped screenshot(s):\n${skippedString}`);
        }

        if (result.failed.length > 0) {
            const failedString = result.failed.map(client =>
                ` ❌ ${client}\n`).join('\n');
            console.error(`${result.failed.length} failed screenshot(s):\n${failedString}`);
        }

        return result;
    }
}

module.exports = { EoaClient };
