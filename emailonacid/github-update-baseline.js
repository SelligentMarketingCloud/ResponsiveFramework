// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call and
// forwards the update request to a CORS-enabled proxy endpoint.
//
// The proxy is expected to run server-side (e.g. Cloudflare Worker), authenticate
// as a GitHub App installation, and dispatch the workflow event to GitHub.
// This avoids exposing PATs/secrets in the browser and avoids GitHub OAuth CORS
// limitations on github.com/login/* endpoints.
//
// Flow for each "Update" click:
//   1. Resolve the clientId from the report's injected data.
//   2. POST request details to the configured proxy endpoint.
//   3. Proxy dispatches `eoa-update-baseline` to GitHub using an installation token.
//   4. Workflow fetches compare image and pushes the updated baseline.
(function () {
    'use strict';

    var config = window.__eoa_config__;
    if (!config || !config.prNumber) return;

    var originalFetch = window.fetch.bind(window);

    // Intercept the report library's PUT /api/reports call that backs "Update".
    window.fetch = function (url, options) {
        if (typeof url === 'string' &&
            url === '/api/reports' &&
            options && String(options.method || '').toUpperCase() === 'PUT') {
            var payload;
            try {
                payload = JSON.parse(options.body);
            } catch (e) {
                return Promise.reject(new Error('Unexpected update payload: ' + e.message));
            }
            return handleUpdate(payload)
                .then(function () { return new Response('', { status: 200 }); });
        }
        return originalFetch(url, options);
    };

    function handleUpdate(payload) {
        var clientId = resolveClientId(payload.suiteId, payload.name);
        if (!clientId) {
            return Promise.reject(new Error(
                'Could not resolve image for suite "' + payload.suiteId +
                '", test "' + payload.name + '"'
            ));
        }
        return dispatchUpdateViaProxy(clientId);
    }

    // Walk the injected report data to find the specFilename for the given
    // suite/test combination (e.g. "Windows / Desktop / Outlook 365").
    function resolveClientId(suiteId, name) {
        var report = window.__injectedData__ && window.__injectedData__.report;
        if (!report) return null;
        for (var i = 0; i < report.suites.length; i++) {
            var suite = report.suites[i];
            if (suite.id !== suiteId && suite.path !== suiteId) continue;
            for (var j = 0; j < suite.tests.length; j++) {
                var test = suite.tests[j];
                if (test.name === name && test.specFilename) {
                    // Strip the .png extension to get the client ID used as the filename.
                    var filename = test.specFilename;
                    return /\.png$/i.test(filename)
                        ? filename.slice(0, -4)
                        : filename;
                }
            }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Dispatch the update through a GitHub App proxy endpoint
    // -------------------------------------------------------------------------

    function dispatchUpdateViaProxy(clientId) {
        var proxyUrl = config.githubAppProxyUrl;
        if (!proxyUrl) {
            return Promise.reject(new Error(
                'GitHub App proxy URL is not configured. Set EOA_GITHUB_APP_PROXY_URL repository variable.'
            ));
        }

        var requestPayload = {
            owner: config.owner,
            repo: config.repo,
            event_type: 'eoa-update-baseline',
            client_payload: {
                clientId: clientId,
                prNumber: config.prNumber,
                branch: config.branch,
                compareUrl: config.eoaUrl + 'compare/' + clientId + '.png',
            },
        };

        return originalFetch(proxyUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(requestPayload),
        }).then(function (res) {
            return readBody(res).then(function (body) {
                if (!res.ok) {
                    var message = body && body.message ? body.message : body && body.raw ? body.raw : 'Unknown error';
                    throw new Error('Proxy dispatch failed (' + res.status + '): ' + message);
                }
            });
        });
    }

    function readBody(res) {
        return res.text().then(function (text) {
            if (!text) return {};
            try {
                return JSON.parse(text);
            } catch (e) {
                return { raw: text };
            }
        });
    }
})();
