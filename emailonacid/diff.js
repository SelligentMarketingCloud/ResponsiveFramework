const { compare } = require("odiff-bin");
const fs = require('fs');

async function run() {

    const clients = ['applemail16', 'iphone16promax_18_dm', 'gmailcom-lm_edgecurrent_win10'];

    fs.mkdirSync('../output/diff', { recursive: true });

    for (const client of clients) {

        const { match, reason } = await compare(
            `../baseline/${client}.png`,
            `../output/${client}.png`,
            `../output/diff/${client}.png`
        );

        console.log(`[diff] ${client} match: ${match} ${reason ? '- ' + reason : ''}`);
    }
}

run();
