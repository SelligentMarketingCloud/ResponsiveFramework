const { compare } = require("odiff-bin");
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

async function getCroppedImages(clientId) {

    const baseImage = `../diff/base/${clientId}.png`;
    const compareImage = `../diff/compare/${clientId}.png`;

    if (!fs.existsSync(baseImage) ||
        !fs.existsSync(compareImage)) {
        return {
            baseImage,
            compareImage
        };
    }

    const baseSharp = sharp(baseImage);
    const compareSharp = sharp(compareImage);
    const { width: baseWidth, height: baseHeight } = await baseSharp.metadata();
    const { width: compareWidth, height: compareHeight } = await compareSharp.metadata();
    const width = Math.min(baseWidth, compareWidth);
    const height = Math.min(baseHeight, compareHeight);

    let baseCrop = '';
    if (baseWidth > width || baseHeight > height) {
        const left = Math.floor((baseWidth - width) / 2);
        await baseSharp
            .extract({ left, top: 0, width, height })
            .toFile(`../diff/base/${clientId}_cropped.png`);
        baseCrop = '_cropped';
    }

    let compareCrop = '';
    if (compareWidth > width || compareHeight > height) {
        const left = Math.floor((compareWidth - width) / 2);
        await compareSharp
            .extract({ left, top: 0, width, height })
            .toFile(`../diff/compare/${clientId}_cropped.png`);
        compareCrop = '_cropped';
    }
    
    return {
        baseImage: `../diff/base/${clientId}${baseCrop}.png`,
        compareImage: `../diff/compare/${clientId}${compareCrop}.png`
    };
}

async function compareWithBestOffset(baseImage, compareImage, diffImage, failureThreshold) {
    if (!fs.existsSync(baseImage) || !fs.existsSync(compareImage)) {
        const { reason, diffPercentage, match: pixelMatch, file } = await compare(
            baseImage, compareImage, diffImage, { failureThreshold, noFailOnFsErrors: true });
        const percentage = reason === 'pixel-diff' ? diffPercentage / 100 : 1;
        return { reason, percentage, match: pixelMatch || percentage < failureThreshold, file };
    }

    const { width: bw, height: bh } = await sharp(baseImage).metadata();
    const { width: cw, height: ch } = await sharp(compareImage).metadata();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `eoa-diff-${process.pid}-`));
    let bestPercentage = Infinity;
    let bestReason = null;
    let bestFile = null;

    // Try (0,0) first — the most likely perfect match — then the 8 shifted offsets.
    const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

    try {
        for (const [dx, dy] of offsets) {
            const width = Math.min(bw, cw) - Math.abs(dx);
            const height = Math.min(bh, ch) - Math.abs(dy);
            if (width <= 0 || height <= 0) continue;

            const baseLeft = Math.max(0, dx);
            const baseTop  = Math.max(0, dy);
            const cmpLeft  = Math.max(0, -dx);
            const cmpTop   = Math.max(0, -dy);

            const tmpBase    = path.join(tmpDir, `base_${dx}_${dy}.png`);
            const tmpCompare = path.join(tmpDir, `cmp_${dx}_${dy}.png`);
            const tmpDiff    = path.join(tmpDir, `diff_${dx}_${dy}.png`);

            await sharp(baseImage).extract({ left: baseLeft, top: baseTop, width, height }).toFile(tmpBase);
            await sharp(compareImage).extract({ left: cmpLeft, top: cmpTop, width, height }).toFile(tmpCompare);

            const result = await compare(tmpBase, tmpCompare, tmpDiff, {
                noFailOnFsErrors: true,
            });

            let percentage;
            if (result.match) {
                percentage = 0;
            } else if (result.reason === 'pixel-diff') {
                percentage = result.diffPercentage / 100;
            } else {
                percentage = 1;
            }

            if (percentage < bestPercentage) {
                bestPercentage = percentage;
                bestReason = result.reason;
                bestFile = result.file;

                if (fs.existsSync(tmpDiff)) {
                    fs.copyFileSync(tmpDiff, diffImage);
                }

                // Perfect match — no need to try remaining offsets.
                if (bestPercentage === 0) break;
            }
        }
    } finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            console.error(`[diff] Failed to clean up temp directory ${tmpDir}: ${e.message}`);
        }
    }

    const match = bestPercentage < failureThreshold;
    return { reason: bestReason, percentage: bestPercentage, match, file: bestFile };
}

async function createDiff(threshold, clientId, clientsMap) {

    const failureThreshold = threshold;

    const { baseImage, compareImage } = await getCroppedImages(clientId);

    console.log(`[diff] Comparing images for ${clientId}: ${baseImage} vs ${compareImage}`);

    const { reason, percentage, match, file } = await compareWithBestOffset(
        baseImage,
        compareImage,
        `../diff/diff/${clientId}.png`,
        failureThreshold,
    );

    const { client, os, category, browser } = clientsMap[clientId];

    const name = [os, category, browser]
        .filter(x => x)
        .join(' / ');

    console[match ? 'log' : 'error'](`[diff] ${clientId} match: ${match} ${reason ? '- ' + reason : ''} ${file ? ' (' + file + ')' : ''}`);

    return {
        clientId,
        match,
        percentage,
        failureThreshold,
        client,
        name,
    };
}

function getImage(imagePath) {
    const normalizedPath = path.join('../diff/', imagePath);
    if (fs.existsSync(normalizedPath)) {
        return imagePath;
    }
    return './base/no_image_available.png';
}

async function run() {

    const clientIds = fs.readFileSync('clients.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

    const clientsMap = JSON.parse(fs.readFileSync('clients.json', 'utf-8')).clients;

    fs.mkdirSync('../output/diff', { recursive: true });

    // One pixel shifts are corrected by trying ±1px offsets before comparing.
    const threshold = 0.015;

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
                baselinePath: getImage(`./base/${clientId}.png`),
                diffPath: match ? '' : getImage(`./diff/${clientId}.png`),
                comparisonPath: getImage(`./compare/${clientId}.png`),
            })),
        })),
    }
}

(async () => {
    const result = await run();

    const jsonResult = JSON.stringify(result, null, 2);

    fs.writeFileSync('../diff/result.json', jsonResult);
})();
