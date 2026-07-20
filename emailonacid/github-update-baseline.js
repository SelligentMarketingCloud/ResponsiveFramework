// Injected into the static EOA diff report to enable updating baselines directly
// from the browser. Intercepts the built-in "Update" button's API call and
// performs the full Git LFS upload + GitHub Contents API pointer update
// without leaving the browser or triggering a separate CI pipeline.
//
// Flow for each "Update" click:
//   1. Resolve the clientId from the report's injected data.
//   2. Fetch the compare image (PNG) from the Pages URL – same origin, no CORS.
//   3. Compute the SHA-256 hash and byte-size of the image.
//   4. Call the GitHub LFS Batch API to obtain a pre-signed upload URL.
//   5. PUT the raw bytes to that URL (Azure Blob Storage, CORS-open).
//   6. GET the current file from the GitHub Contents API to obtain its blob SHA.
//   7. PUT the new LFS pointer text via the GitHub Contents API.
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
            return uploadBaseline(token, clientId);
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
    // Token management
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
        var token = window.prompt(
            'Enter a GitHub Personal Access Token with "repo" scope ' +
            'to update the baseline image on the pull request.\n\n' +
            'Create one at:\n  https://github.com/settings/tokens\n\n' +
            'The token is stored in sessionStorage for this browser session only.'
        );
        if (!token) return Promise.resolve(null);
        token = token.trim();
        sessionStorage.setItem(TOKEN_KEY, token);
        return Promise.resolve(token);
    }

    // -------------------------------------------------------------------------
    // Main upload flow
    // -------------------------------------------------------------------------

    function uploadBaseline(token, clientId) {
        var imageUrl = config.eoaUrl + 'compare/' + clientId + '.png';
        var repoFilePath = 'output/' + clientId + '.png';

        // Step 1: fetch the compare image (same-origin Pages URL).
        return originalFetch(imageUrl)
            .then(function (res) {
                if (!res.ok) {
                    throw new Error('Failed to fetch compare image: HTTP ' + res.status);
                }
                return res.arrayBuffer();
            })
            .then(function (buffer) {
                // Step 2: compute SHA-256 hash and byte-size.
                return crypto.subtle.digest('SHA-256', buffer).then(function (hashBuffer) {
                    return {
                        buffer: buffer,
                        sha256: arrayBufferToHex(hashBuffer),
                        size: buffer.byteLength,
                    };
                });
            })
            .then(function (img) {
                // Steps 3–4: LFS Batch request → upload binary.
                return lfsUpload(token, img.sha256, img.size, img.buffer).then(function () {
                    return img;
                });
            })
            .then(function (img) {
                // Steps 5–6: update the LFS pointer file in the repo.
                var pointer = buildLfsPointer(img.sha256, img.size);
                return updateRepoFile(token, repoFilePath, pointer, clientId);
            })
            .catch(function (err) {
                // Clear a cached token whenever a 401 surfaces so the next
                // click re-prompts rather than failing silently again.
                if (err && /\b401\b/.test(err.message)) clearToken();
                throw err;
            });
    }

    // -------------------------------------------------------------------------
    // LFS helpers
    // -------------------------------------------------------------------------

    function arrayBufferToHex(buffer) {
        var bytes = new Uint8Array(buffer);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += ('0' + bytes[i].toString(16)).slice(-2);
        }
        return hex;
    }

    function buildLfsPointer(sha256, size) {
        return 'version https://git-lfs.github.com/spec/v1\n' +
               'oid sha256:' + sha256 + '\n' +
               'size ' + size + '\n';
    }

    // Step 3: call the LFS Batch API to register the object and obtain an
    //         upload URL, then PUT the raw bytes to that URL (Step 4).
    function lfsUpload(token, sha256, size, buffer) {
        var owner = config.owner;
        var repo  = config.repo;
        var batchUrl = 'https://github.com/' + owner + '/' + repo +
                       '.git/info/lfs/objects/batch';

        return originalFetch(batchUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'token ' + token,
                'Content-Type': 'application/vnd.git-lfs+json',
                'Accept':        'application/vnd.git-lfs+json',
            },
            body: JSON.stringify({
                operation: 'upload',
                transfers: ['basic'],
                objects: [{ oid: sha256, size: size }],
            }),
        }).then(function (res) {
            if (res.status === 401) {
                clearToken();
                throw new Error('GitHub token is invalid or expired (401). Please try again.');
            }
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('LFS batch request failed (' + res.status + '): ' + body);
                });
            }
            return res.json();
        }).then(function (batch) {
            var obj = batch.objects && batch.objects[0];
            if (!obj) throw new Error('LFS batch response contained no objects.');

            // If the server reports the object already exists, skip the upload.
            if (!obj.actions || !obj.actions.upload) {
                console.log('[eoa] LFS object already exists in storage; skipping upload.');
                return;
            }

            var upload = obj.actions.upload;
            // Merge any server-supplied headers (e.g. SAS tokens) with the
            // content-type header required for raw binary uploads.
            var uploadHeaders = Object.assign(
                { 'Content-Type': 'application/octet-stream' },
                upload.header || {}
            );

            return originalFetch(upload.href, {
                method: 'PUT',
                headers: uploadHeaders,
                body: buffer,
            }).then(function (res) {
                if (!res.ok) {
                    return res.text().then(function (body) {
                        throw new Error('LFS upload failed (' + res.status + '): ' + body);
                    });
                }
            });
        });
    }

    // -------------------------------------------------------------------------
    // GitHub Contents API helpers
    // -------------------------------------------------------------------------

    function ghHeaders(token) {
        return {
            'Authorization':       'token ' + token,
            'Content-Type':        'application/json',
            'Accept':              'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
    }

    // Steps 5–6: retrieve the current blob SHA then PUT the new LFS pointer.
    function updateRepoFile(token, filePath, pointerText, clientId) {
        var owner  = config.owner;
        var repo   = config.repo;
        var branch = config.branch;
        var apiBase = 'https://api.github.com/repos/' + owner + '/' + repo +
                      '/contents/' + filePath;

        // GET the current file to obtain its blob SHA (required for updates).
        // A 404 means the file doesn't exist yet in the repo; we create it.
        return originalFetch(apiBase + '?ref=' + encodeURIComponent(branch), {
            headers: ghHeaders(token),
        }).then(function (res) {
            if (res.status === 401) {
                clearToken();
                throw new Error('GitHub token is invalid or expired (401). Please try again.');
            }
            if (res.status !== 200 && res.status !== 404) {
                return res.text().then(function (body) {
                    throw new Error(
                        'Could not read current file metadata (' + res.status + '): ' + body
                    );
                });
            }
            return res.status === 404 ? null : res.json();
        }).then(function (file) {
            // The Contents API requires Base64-encoded content.
            // The LFS pointer is pure ASCII so btoa() is safe.
            var body = {
                message: 'chore(eoa): update baseline screenshot for ' + clientId,
                content: btoa(pointerText),
                branch: branch,
            };
            // Include the existing blob SHA when updating an already-tracked file.
            if (file) body.sha = file.sha;

            return originalFetch(apiBase, {
                method: 'PUT',
                headers: ghHeaders(token),
                body: JSON.stringify(body),
            });
        }).then(function (res) {
            if (res.status === 401) {
                clearToken();
                throw new Error('GitHub token is invalid or expired (401). Please try again.');
            }
            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error('File update failed (' + res.status + '): ' + body);
                });
            }
        });
    }
})();

