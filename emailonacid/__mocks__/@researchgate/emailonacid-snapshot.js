'use strict';

const configureCreateEmail = jest.fn(() =>
    jest.fn((emailContent) => ({
        screenshot: jest.fn(async (client) => {
            if (client.indexOf('fail') >= 0) {
                throw new Error('Invalid client');
            }
            return `screenshot-data-for-${client}`;
        }),
        clean: jest.fn(async () => {
            return;
        })
    }))
);

module.exports = { configureCreateEmail };