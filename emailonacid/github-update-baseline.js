// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call and
// forwards the update request to a CORS-enabled proxy endpoint.
//
// The proxy runs server-side (e.g. Cloudflare Worker), requires each user to
// authenticate via GitHub App OAuth, and then dispatches the workflow event as
// that authenticated user.
(function () {
    'use strict';

    // Wait up to 120000 milliseconds for the OAuth popup to complete.
    var AUTH_POPUP_TIMEOUT_MS = 120000;

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

    function resolveClientId(suiteId, name) {
        var report = window.__injectedData__ && window.__injectedData__.report;
        if (!report) return null;
        for (var i = 0; i < report.suites.length; i++) {
            var suite = report.suites[i];
            if (suite.id !== suiteId && suite.path !== suiteId) continue;
            for (var j = 0; j < suite.tests.length; j++) {
                var test = suite.tests[j];
                if (test.name === name && test.specFilename) {
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
    // Dispatch the update through a user-authenticated GitHub App proxy endpoint
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

        return ensureAuthenticated(proxyUrl)
            .then(function () {
                return postDispatch(proxyUrl, requestPayload);
            })
            .catch(function (error) {
                return Promise.reject(new Error('Could not send baseline update: ' + error.message));
            });
    }

    function ensureAuthenticated(proxyUrl) {
        return authStatus(proxyUrl).then(function (status) {
            if (status.authenticated) {
                return status;
            }
            return startAuthFlow(proxyUrl).then(function () {
                return authStatus(proxyUrl).then(function (afterAuth) {
                    if (!afterAuth.authenticated) {
                        throw new Error('Authentication completed but no active session was found');
                    }
                    return afterAuth;
                });
            });
        });
    }

    function authStatus(proxyUrl) {
        return originalFetch(buildProxyUrl(proxyUrl, '/auth/status'), {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
        }).then(function (res) {
            return readBody(res).then(function (body) {
                if (!res.ok) {
                    var message = body && body.message ? body.message : 'Failed to load authentication status';
                    throw new Error(message);
                }
                return body || {};
            });
        });
    }

    function postDispatch(proxyUrl, requestPayload) {
        return originalFetch(proxyUrl, {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(requestPayload),
        }).then(function (res) {
            return readBody(res).then(function (body) {
                if (res.status === 401 && body && body.authUrl) {
                    return startAuthFlow(proxyUrl, body.authUrl)
                        .then(function () { return postDispatch(proxyUrl, requestPayload); });
                }
                if (!res.ok) {
                    var message = body && body.message ? body.message : body && body.raw ? body.raw : 'Unknown error';
                    throw new Error('Proxy dispatch failed (' + res.status + '): ' + message);
                }
            });
        });
    }

    function startAuthFlow(proxyUrl, authUrl) {
        var loginUrl = authUrl || buildProxyUrl(proxyUrl, '/auth/start');
        var popup = window.open(loginUrl, 'eoa-github-auth', 'width=520,height=740,noopener,noreferrer');
        if (!popup) {
            return Promise.reject(new Error('Login popup was blocked by the browser'));
        }

        return new Promise(function (resolve, reject) {
            var finished = false;
            var timeout = setTimeout(function () {
                cleanup();
                reject(new Error('Timed out waiting for GitHub authentication'));
            }, AUTH_POPUP_TIMEOUT_MS);

            var closedInterval = setInterval(function () {
                if (!popup || popup.closed) {
                    cleanup();
                    if (!finished) {
                        reject(new Error('Authentication popup was closed before completing sign-in'));
                    }
                }
            }, 500);

            function onMessage(event) {
                if (!event || !event.data || event.data.type !== 'eoa-github-auth') return;
                finished = true;
                cleanup();
                if (event.data.ok) {
                    resolve();
                } else {
                    reject(new Error(event.data.error || 'Authentication failed'));
                }
            }

            function cleanup() {
                clearTimeout(timeout);
                clearInterval(closedInterval);
                window.removeEventListener('message', onMessage);
                try {
                    if (popup && !popup.closed) popup.close();
                } catch (e) {
                    // Ignore cross-origin popup close errors.
                }
            }

            window.addEventListener('message', onMessage);
        });
    }

    function buildProxyUrl(baseUrl, suffixPath) {
        var url = new URL(baseUrl, window.location.href);
        var normalizedBasePath = url.pathname.replace(/\/+$/, '');
        url.pathname = normalizedBasePath + suffixPath;
        url.search = '';
        url.hash = '';
        return url.toString();
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
