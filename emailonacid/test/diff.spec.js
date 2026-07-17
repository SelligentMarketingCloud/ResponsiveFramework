const fs = require('fs');
const os = require('os');
const path = require('path');
const { compareWithBestOffset, normalizeImagePair } = require('../diff');

describe('compareWithBestOffset', () => {
    test('should match images with 1px horizontal offset', async () => {
        const failureThreshold = 0.015; // Same threshold used by the production diff flow.
        const baseImage = path.join(__dirname, 'base', 'm365com-lm_chrcurrent_win10.png');
        const compareImage = path.join(__dirname, 'compare', 'm365com-lm_chrcurrent_win10.png');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emailonacid-diff-test-'));
        const normalizedBaseImage = path.join(tmpDir, 'base-cropped.png');
        const normalizedCompareImage = path.join(tmpDir, 'compare-cropped.png');
        const diffImage = path.join(tmpDir, 'diff.png');

        try {
            const normalized = await normalizeImagePair(baseImage, compareImage, {
                baseOutputPath: normalizedBaseImage,
                compareOutputPath: normalizedCompareImage,
            });

            const result = await compareWithBestOffset(
                normalized.baseImage,
                normalized.compareImage,
                diffImage,
                failureThreshold,
            );

            expect(result.match).toBe(true);
            expect(result.percentage).toBeLessThan(failureThreshold);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
