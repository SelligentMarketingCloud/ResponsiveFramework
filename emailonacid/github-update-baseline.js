// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call and
// redirects it to a GitHub Actions workflow that commits the new baseline image
// via Git LFS on the pull request branch.
(function () {
    'use strict';

    var config = window.__eoa_config__;
    if (!config || !config.prNumber) return;

    var TOKEN_KEY = 'eoa_gh_token';
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
        return getToken().then(function (token) {
            if (!token) throw new Error('GitHub authentication cancelled.');
            return dispatchWorkflow(token, clientId);
        });
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

    function getToken() {
        var cached = sessionStorage.getItem(TOKEN_KEY);
        if (cached) return Promise.resolve(cached);
        return promptForToken();
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function promptForToken() {
        var token = window.prompt(
            'Enter a GitHub Personal Access Token with "repo" and "workflow" scopes ' +
            'to update the baseline image on the pull request.\n\n' +
            'Create one at:\n  https://github.com/settings/tokens\n\n' +
            'The token is stored in sessionStorage for this browser session only.'
        );
        if (!token) return Promise.resolve(null);
        token = token.trim();
        sessionStorage.setItem(TOKEN_KEY, token);
        return Promise.resolve(token);
    }

    function dispatchWorkflow(token, clientId) {
        var owner = config.owner;
        var repo = config.repo;
        var apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo +
            '/actions/workflows/update-baseline.yml/dispatches';

        return originalFetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'token ' + token,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                ref: config.defaultBranch,
                inputs: {
                    pr_number: String(config.prNumber),
                    client_id: clientId,
                    eoa_url: config.eoaUrl
                }
            })
        }).then(function (res) {
            if (res.status === 204) return; // success – GitHub returns 204 No Content
            if (res.status === 401) {
                // Token is invalid or revoked – clear it so the next attempt re-prompts.
                clearToken();
                throw new Error('GitHub token is invalid or expired. Please try again.');
            }
            return res.text().then(function (body) {
                throw new Error('Workflow dispatch failed (' + res.status + '): ' + body);
            });
        });
    }
})();
