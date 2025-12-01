const { EoaClient } = require('./eoa-client');
const config = require('./eoa-config');

(async () => {
    
    const emailClient = new EoaClient({
        clientsPath: 'clients.txt'
    });

    const content = config.getContent();

    const { success, skipped, failed } = await emailClient.collectScreenshots(content);

    process.exit(failed.length);
})();
