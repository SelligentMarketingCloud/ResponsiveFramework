'use strict';

const createClient = jest.fn(({ defaultClients }) => ({
  getClients: jest.fn(() =>
    defaultClients
        .filter(client =>
            client.indexOf('some_invalid_client') < 0)
        .reduce((acc, client) => ([
            ...acc,
            {
                id: client,
                client: `Client ${client}`,
                os: 'Some OS',
                category: 'Some Category',
                browser: 'Some Browser',
                default: true,
            }
        ]), [])
  ),
  createTest: jest.fn(() => {
    return { testId: 'test123' };
  }),
  getTest: jest.fn((testId) => {
    return { testId };
  })
}));

module.exports = createClient;