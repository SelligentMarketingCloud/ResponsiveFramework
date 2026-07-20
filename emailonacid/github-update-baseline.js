// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call,
// authenticates the user via a GitHub Personal Access Token (PAT) prompt,
// then fires a repository_dispatch event that triggers a pipeline job to perform
// the actual Git LFS update – bypassing browser CORS restrictions on the LFS
// endpoint.
//
// The GitHub OAuth Device Flow cannot be used here because the GitHub OAuth
// endpoints (github.com/login/device/code, github.com/login/oauth/access_token)
// do not include CORS headers, causing browsers to block those requests.
// A PAT entered directly by the user avoids this entirely.
//
// Flow for each "Update" click:
//   1. Resolve the clientId from the report's injected data.
//   2. Prompt the user for a GitHub Personal Access Token (cached in sessionStorage).
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
    // Token management – GitHub Personal Access Token prompt
    //
    // The GitHub OAuth Device Flow cannot be used here because the required
    // endpoints (github.com/login/device/code, github.com/login/oauth/access_token)
    // do not include CORS headers, causing browsers to block those requests.
    // Instead the user supplies a PAT directly; only api.github.com is then
    // called, which does support CORS.
    // -------------------------------------------------------------------------

    function getToken() {
        var cached = sessionStorage.getItem(TOKEN_KEY);
        if (cached) return Promise.resolve(cached);
        return promptForToken();
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function promptForToken() {
        return new Promise(function (resolve, reject) {
            showTokenModal(function (token) {
                if (!token) {
                    reject(new Error('GitHub authentication cancelled.'));
                    return;
                }
                sessionStorage.setItem(TOKEN_KEY, token);
                resolve(token);
            });
        });
    }

    // -------------------------------------------------------------------------
    // PAT prompt modal UI
    // -------------------------------------------------------------------------

    var MODAL_ID = 'eoa-pat-modal';

    function showTokenModal(callback) {
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
            'max-width:440px', 'width:90%', 'text-align:center',
            'font-family:system-ui,sans-serif', 'box-shadow:0 4px 32px rgba(0,0,0,0.3)',
        ].join(';');

        var heading = document.createElement('h2');
        heading.textContent = 'GitHub Authorization Required';
        heading.style.cssText = 'margin:0 0 12px;font-size:1.2rem;';

        var instructions = document.createElement('p');
        instructions.style.cssText = 'margin:0 0 16px;color:#444;font-size:0.95rem;line-height:1.5;text-align:left;';
        instructions.innerHTML =
            'Enter a GitHub Personal Access Token with the <code>repo</code> scope ' +
            'to authorize the baseline update. The token is stored only in your ' +
            'browser session and is never sent to any server other than GitHub.';

        var createLink = document.createElement('a');
        createLink.href = 'https://github.com/settings/tokens/new?scopes=repo&description=EOA+baseline+update';
        createLink.target = '_blank';
        createLink.rel = 'noopener noreferrer';
        createLink.textContent = 'Create a token on GitHub \u2197';
        createLink.style.cssText = 'display:block;font-size:0.85rem;margin-bottom:16px;color:#0969da;';

        var input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'ghp_…';
        input.style.cssText = [
            'display:block', 'width:100%', 'box-sizing:border-box',
            'border:1px solid #d0d7de', 'border-radius:6px',
            'padding:8px 12px', 'font-size:0.95rem', 'margin-bottom:16px',
            'font-family:monospace',
        ].join(';');

        var buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';

        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Authorize';
        confirmBtn.style.cssText = [
            'background:#238636', 'color:#fff', 'border:none',
            'border-radius:6px', 'padding:8px 20px',
            'font-size:0.95rem', 'cursor:pointer',
        ].join(';');

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = [
            'background:#f6f8fa', 'color:#24292f', 'border:1px solid #d0d7de',
            'border-radius:6px', 'padding:8px 20px',
            'font-size:0.95rem', 'cursor:pointer',
        ].join(';');

        function submit() {
            var token = input.value.trim();
            overlay.parentNode.removeChild(overlay);
            callback(token || null);
        }

        function cancel() {
            overlay.parentNode.removeChild(overlay);
            callback(null);
        }

        confirmBtn.addEventListener('click', submit);
        cancelBtn.addEventListener('click', cancel);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
        });

        buttonRow.appendChild(confirmBtn);
        buttonRow.appendChild(cancelBtn);
        [heading, instructions, createLink, input, buttonRow].forEach(function (el) {
            box.appendChild(el);
        });
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        input.focus();
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
                    'Ensure the Personal Access Token has the "repo" scope.'
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

