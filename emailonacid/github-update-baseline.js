// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call,
// authenticates the user via the GitHub OAuth Device Flow (no PAT required),
// then fires a repository_dispatch event that triggers a pipeline job to perform
// the actual Git LFS update – bypassing browser CORS restrictions on the LFS
// endpoint.
//
// Flow for each "Update" click:
//   1. Resolve the clientId from the report's injected data.
//   2. Obtain a GitHub OAuth token via the Device Flow (cached in sessionStorage).
//   3. POST a repository_dispatch event to the GitHub API (CORS-enabled) with the
//      clientId, branch, and compare image URL as the payload.
//   4. The triggered workflow fetches the compare image and pushes the updated
//      LFS-tracked baseline file using the built-in GITHUB_TOKEN.
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
            return dispatchUpdate(token, clientId);
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

    // -------------------------------------------------------------------------
    // Token management – GitHub OAuth Device Flow
    // -------------------------------------------------------------------------

    function getToken() {
        var cached = sessionStorage.getItem(TOKEN_KEY);
        if (cached) return Promise.resolve(cached);
        if (!config.oauthClientId) {
            return Promise.reject(new Error(
                'No OAuth client ID configured. Set the EOA_OAUTH_CLIENT_ID ' +
                'repository variable to the GitHub OAuth App client ID.'
            ));
        }
        return runDeviceFlow(config.oauthClientId);
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function runDeviceFlow(clientId) {
        // Step 1: request a device + user code from GitHub.
        return originalFetch('https://github.com/login/device/code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('Device flow initiation failed (' + res.status + '): ' + body);
                });
            }
            return res.json();
        }).then(function (data) {
            // Step 2: show the user the one-time code and open the activation page.
            showDeviceFlowModal(
                data.user_code,
                data.verification_uri || 'https://github.com/activate'
            );
            // Step 3: poll until the user completes authorization.
            return pollForToken(clientId, data.device_code, (data.interval || 5) * 1000);
        });
    }

    function pollForToken(clientId, deviceCode, interval) {
        return new Promise(function (resolve, reject) {
            function poll() {
                originalFetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        client_id: clientId,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    }),
                }).then(function (res) {
                    return res.json();
                }).then(function (data) {
                    if (data.access_token) {
                        closeDeviceFlowModal();
                        sessionStorage.setItem(TOKEN_KEY, data.access_token);
                        resolve(data.access_token);
                    } else if (data.error === 'authorization_pending') {
                        setTimeout(poll, interval);
                    } else if (data.error === 'slow_down') {
                        // Server asked us to back off; add 5 s on top of the base interval.
                        interval += 5000;
                        setTimeout(poll, interval);
                    } else if (data.error === 'expired_token') {
                        closeDeviceFlowModal();
                        reject(new Error('Device code expired. Please click Update again.'));
                    } else if (data.error === 'access_denied') {
                        closeDeviceFlowModal();
                        reject(new Error('Authorization was denied.'));
                    } else {
                        closeDeviceFlowModal();
                        reject(new Error('OAuth error: ' + (data.error_description || data.error)));
                    }
                }).catch(function (err) {
                    closeDeviceFlowModal();
                    reject(err);
                });
            }

            poll();
        });
    }

    // -------------------------------------------------------------------------
    // Device Flow modal UI
    // -------------------------------------------------------------------------

    var MODAL_ID = 'eoa-device-flow-modal';

    function showDeviceFlowModal(userCode, verificationUri) {
        var existing = document.getElementById(MODAL_ID);
        if (existing) existing.parentNode.removeChild(existing);

        var overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.6)',
        ].join(';');

        var box = document.createElement('div');
        box.style.cssText = [
            'background:#fff', 'border-radius:8px', 'padding:32px 40px',
            'max-width:400px', 'width:90%', 'text-align:center',
            'font-family:system-ui,sans-serif', 'box-shadow:0 4px 32px rgba(0,0,0,0.3)',
        ].join(';');

        var heading = document.createElement('h2');
        heading.textContent = 'Authorize GitHub';
        heading.style.cssText = 'margin:0 0 12px;font-size:1.2rem;';

        var instructions = document.createElement('p');
        instructions.style.cssText = 'margin:0 0 20px;color:#444;font-size:0.95rem;line-height:1.5;';
        instructions.textContent =
            'Open the link below and enter this code to authorize the baseline update:';

        var codeEl = document.createElement('div');
        codeEl.textContent = userCode;
        codeEl.style.cssText = [
            'font-size:2rem', 'font-weight:bold', 'letter-spacing:0.15em',
            'font-family:monospace', 'background:#f0f4f8', 'border-radius:6px',
            'padding:12px', 'margin:0 0 20px', 'user-select:all',
        ].join(';');

        var link = document.createElement('a');
        link.href = verificationUri;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open GitHub Authorization Page';
        link.style.cssText = [
            'display:inline-block', 'background:#238636', 'color:#fff',
            'text-decoration:none', 'border-radius:6px', 'padding:10px 20px',
            'font-size:0.95rem', 'margin-bottom:16px',
        ].join(';');

        var status = document.createElement('p');
        status.style.cssText = 'color:#666;font-size:0.85rem;margin:0;';
        status.textContent = 'Waiting for authorization\u2026';

        [heading, instructions, codeEl, link, status].forEach(function (el) {
            box.appendChild(el);
        });
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    function closeDeviceFlowModal() {
        var el = document.getElementById(MODAL_ID);
        if (el) el.parentNode.removeChild(el);
    }

    // -------------------------------------------------------------------------
    // Dispatch the update to the pipeline via repository_dispatch
    // -------------------------------------------------------------------------

    function dispatchUpdate(token, clientId) {
        var owner      = config.owner;
        var repo       = config.repo;
        var branch     = config.branch;
        var compareUrl = config.eoaUrl + 'compare/' + clientId + '.png';

        return originalFetch(
            'https://api.github.com/repos/' + owner + '/' + repo + '/dispatches',
            {
                method: 'POST',
                headers: {
                    'Authorization':        'token ' + token,
                    'Content-Type':         'application/json',
                    'Accept':               'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                body: JSON.stringify({
                    event_type: 'eoa-update-baseline',
                    client_payload: {
                        clientId:   clientId,
                        prNumber:   config.prNumber,
                        branch:     branch,
                        compareUrl: compareUrl,
                    },
                }),
            }
        ).then(function (res) {
            if (res.status === 401) {
                clearToken();
                throw new Error('GitHub token is invalid or expired (401). Please try again.');
            }
            if (res.status === 403) {
                throw new Error(
                    'Token lacks permission to dispatch workflows. ' +
                    'Ensure the authorized OAuth App has the "repo" scope.'
                );
            }
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('Dispatch failed (' + res.status + '): ' + body);
                });
            }
            // 204 No Content on success – the pipeline handles the rest.
        });
    }
})();

