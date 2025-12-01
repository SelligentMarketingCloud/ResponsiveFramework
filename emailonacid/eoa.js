const { EoaClient } = require('./eoa-client');
const config = require('./eoa-config');

(async () => {
    
    const emailClient = new EoaClient({
        apiKey: process.env.EOA_API_KEY,
        accountPassword: process.env.EOA_ACCOUNT_PASSWORD,
        clientsPath: 'clients.txt'
    });

    const content = config.getContent();

    const { success, skipped, failed } = await emailClient.collectScreenshots(content);

    process.exit(failed.length);
})();
