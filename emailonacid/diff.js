const { compare } = require("odiff-bin");
const fs = require('fs');

async function createDiff(threshold, clientId, clientsMap) {

    const failureThreshold = threshold;

    const { reason, diffPercentage } = await compare(
        `../diff/base/${clientId}.png`,
        `../diff/compare/${clientId}.png`,
        `../diff/diff/${clientId}.png`, {
            failureThreshold,
            noFailOnFsErrors: true,
        });

    const percentage = reason == 'pixel-diff'
        ? diffPercentage / 100
        : null;

    const match = percentage < failureThreshold;

    const { client, os, category, browser } = clientsMap[clientId];

    const name = [os, category, browser]
        .filter(x => x)
        .join(' / ');

    console[match ? 'log' : 'error'](`[diff] ${clientId} match: ${match} ${reason ? '- ' + reason : ''}`);

    return {
        clientId,
        match,
        percentage,
        failureThreshold,
        client,
        name,
    };
}

async function run() {

    const clientIds = fs.readFileSync('clients.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

    const clientsMap = JSON.parse(fs.readFileSync('clients.json', 'utf-8')).clients;

    fs.mkdirSync('../output/diff', { recursive: true });

    const threshold = 0.01;

    const allDiffs = await Promise.all(
        clientIds.map(async (clientId) => {
            return await createDiff(threshold, clientId, clientsMap);
        })
    );

    const groupedDiffs = allDiffs.reduce((acc, diff) => {
        const clientName = diff.client;

        if (acc[clientName]) {
            return {...acc, [clientName]: [...acc[clientName], diff]};
        }

        return {...acc, [clientName]: [diff]};
    }, {});

    const sortedGroupedDiffs = Object.values(groupedDiffs).sort((a, b) =>
        a[0].client.localeCompare(b[0].client));

    return {
        total: allDiffs.length,
        totalPassed: allDiffs.filter(diff => diff.match).length,
        totalFailed: allDiffs.filter(diff => !diff.match).length,
        totalSuites: allDiffs.length,
        suites: sortedGroupedDiffs.map((diffs) => ({
            name: diffs[0].client,
            path: `./base/${diffs[0].client}`,
            tests: diffs.map(({ clientId, match, percentage, failureThreshold, name }) => ({
                status: match ? 'pass' : 'fail',
                name,
                percentage,
                failureThreshold,
                specPath: `./base/${clientId}.png`,
                specFilename: `${clientId}.png`,
                baselinePath: `./base/${clientId}.png`,
                diffPath: match ? '' : `./diff/${clientId}.png`,
                comparisonPath: `./compare/${clientId}.png`,
            })),
        })),
    }
}

(async () => {
    const result = await run();

    const jsonResult = JSON.stringify(result, null, 2);

    fs.writeFileSync('../diff/result.json', jsonResult);
})();
