const { EoaClient } = require('../eoa-client');
const path = require('path');
const fs = require('fs');

beforeAll(() => {
    fs.mkdirSync(path.join(__dirname, '../../test'), { recursive: true });
});

afterAll(() => {
    fs.rmdirSync(path.join(__dirname, '../../test'), { recursive: true });
});

test('1 valid and 1 invalid email client returns 1 skipped client', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: ['some_invalid_client']
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    expect(success).toEqual([]);
    expect(skipped).toEqual(['some_invalid_client']);
    expect(failed).toEqual([]);
});

test('1 failing email client returns 1 failed client', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: ['some_fail_client']
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    expect(success).toEqual([]);
    expect(skipped).toEqual([]);
    expect(failed).toEqual(['some_fail_client']);
});

test('1 valid email client returns 1 success client', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: ['some_client']
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    expect(success).toEqual(['some_client']);
    expect(skipped).toEqual([]);
    expect(failed).toEqual([]);
});

test('1 valid, 1 invalid email and 1 failing client returns 1 success, 1 skipped and 1 failed client', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: ['some_client', 'some_invalid_client', 'some_fail_client']
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    expect(success).toEqual(['some_client']);
    expect(skipped).toEqual(['some_invalid_client']);
    expect(failed).toEqual(['some_fail_client']);
});

test('20 valid email clients returns 20 success clients', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: Array.from({ length: 20 }, (_, i) =>
            `some_client_${i + 1}`)
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    for (let i = 0; i < 20; i++) {
        expect(success[i]).toEqual(`some_client_${i + 1}`);
    }
    expect(skipped).toEqual([]);
    expect(failed).toEqual([]);
});

test('9 valid, 3 failing and 9 valid email clients returns 18 valid email clients', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: [
            ...Array.from({ length: 9 }, (_, i) =>
                `some_client_${i + 1}`),
            'some_fail_client_1',
            'some_fail_client_2',
            'some_fail_client_3',
            ...Array.from({ length: 9 }, (_, i) =>
                `some_client_${i + 10}`)
        ]
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    for (let i = 0; i < 18; i++) {
        expect(success[i]).toEqual(`some_client_${i + 1}`);
    }
    expect(skipped).toEqual([]);
    expect(failed).toEqual([
        'some_fail_client_1',
        'some_fail_client_2',
        'some_fail_client_3'
    ]);
});

test('33 alternating valid, failing and invalid email clients returns 11 valid, 11 failing and 11 invalid email clients', async () => {
    const emailClient = new EoaClient({
        basePath: '../test',
        apiKey: 'test-api-key',
        accountPassword: 'test-account-password',
        clients: [
            ...Array.from({ length: 11 }, (_, i) =>
                [
                    `some_client_${i + 1}`,
                    `some_fail_client_${i + 1}`,
                    `some_invalid_client_${i + 1}`,
                ]),
        ].flat()
    });

    const { success, skipped, failed } = await emailClient.collectScreenshots();

    for (let i = 0; i < 11; i++) {
        expect(success[i]).toEqual(`some_client_${i + 1}`);
        expect(failed[i]).toEqual(`some_fail_client_${i + 1}`);
        expect(skipped[i]).toEqual(`some_invalid_client_${i + 1}`);
    }
});