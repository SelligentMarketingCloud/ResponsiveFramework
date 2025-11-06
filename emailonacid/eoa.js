const { configureCreateEmail } = require('@researchgate/emailonacid-snapshot');
const fs = require('fs');

async function run() {

    const clients = ['applemail16', 'iphone16promax_18_dm', 'gmailcom-lm_edgecurrent_win10'];

    const createEmail = configureCreateEmail({
        clients
    });

    const emailContent = fs.readFileSync('../source/latest.html');

    const email = await createEmail(emailContent);

    for (const client of clients) {
        const screenshot = await email.screenshot(client);

        const callback = (err) => {
            console.log(`[screenshot] ${client} ready`);
            if (err) throw err;
        }

        fs.writeFileSync(`../output/${client}.png`, screenshot, callback);
    }

    // assert screenshot at this point
    await email.clean();
}

run();
