const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { compareWithBestOffset } = require('../diff');

describe('compareWithBestOffset', () => {
    test('should match images with 1px horizontal offset', async () => {
        const baseImage = path.join(__dirname, 'base', 'm365com-lm_chrcurrent_win10.png');
        const compareImage = path.join(__dirname, 'compare', 'm365com-lm_chrcurrent_win10.png');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eoa-diff-test-'));
        const croppedBaseImage = path.join(tmpDir, 'base-cropped.png');
        const croppedCompareImage = path.join(tmpDir, 'compare-cropped.png');
        const diffImage = path.join(tmpDir, 'diff.png');
        const failureThreshold = 0.015;

        try {
            const { width: baseWidth, height: baseHeight } = await sharp(baseImage).metadata();
            const { width: compareWidth, height: compareHeight } = await sharp(compareImage).metadata();
            const width = Math.min(baseWidth, compareWidth);
            const height = Math.min(baseHeight, compareHeight);

            await sharp(baseImage)
                .extract({ left: Math.floor((baseWidth - width) / 2), top: 0, width, height })
                .toFile(croppedBaseImage);
            await sharp(compareImage)
                .extract({ left: Math.floor((compareWidth - width) / 2), top: 0, width, height })
                .toFile(croppedCompareImage);

            const result = await compareWithBestOffset(croppedBaseImage, croppedCompareImage, diffImage, failureThreshold);
            expect(result.match).toBe(true);
            expect(result.percentage).toBeLessThan(failureThreshold);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
