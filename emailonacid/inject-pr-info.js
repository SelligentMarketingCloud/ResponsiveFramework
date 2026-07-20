#!/usr/bin/env node
'use strict';

/**
 * inject-pr-info.js
 *
 * Post-processes the static EOA diff report (diff/index.html) produced by
 * cypress-image-diff-html-report to embed pull-request metadata and the
 * browser-side GitHub update handler (github-update-baseline.js).
 *
 * Usage (from the repository root):
 *   node emailonacid/inject-pr-info.js \
 *     --owner <org>           \
 *     --repo <repo>           \
 *     --pr-number <number>    \
 *     --branch <head-branch>  \
 *     --eoa-url <pages-url>   \
 *     [--html-path diff/index.html]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const parsed = {};
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
        console.error('Expected a flag starting with "--", got: ' + arg);
        process.exit(1);
    }
    const key = arg.slice(2);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Flag --' + key + ' requires a value');
        process.exit(1);
    }
    parsed[key] = args[++i];
}

const required = ['owner', 'repo', 'pr-number', 'branch', 'eoa-url'];
const missing = required.filter(k => !parsed[k]);
if (missing.length) {
    console.error('Missing required arguments: ' + missing.map(k => '--' + k).join(', '));
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Config embedded into the report
// ---------------------------------------------------------------------------
const config = {
    owner: parsed['owner'],
    repo: parsed['repo'],
    prNumber: parseInt(parsed['pr-number'], 10),
    branch: parsed['branch'],
    eoaUrl: parsed['eoa-url'],
};

// ---------------------------------------------------------------------------
// Read and patch the report HTML
// ---------------------------------------------------------------------------
const htmlPath = parsed['html-path'] || path.join('diff', 'index.html');

if (!fs.existsSync(htmlPath)) {
    console.error('Report HTML not found: ' + htmlPath);
    process.exit(1);
}

const updateScript = fs.readFileSync(
    path.join(__dirname, 'github-update-baseline.js'),
    'utf-8'
);

const scriptTag = [
    '<script id="eoa-github-update">',
    'window.__eoa_config__ = ' + JSON.stringify(config) + ';',
    updateScript,
    '</script>',
].join('\n');

let html = fs.readFileSync(htmlPath, 'utf-8');

if (html.includes('id="eoa-github-update"')) {
    console.log('PR info already injected; skipping.');
    process.exit(0);
}

const patched = html.replace('</body>', scriptTag + '\n</body>');

if (patched === html) {
    console.error('Could not locate </body> in ' + htmlPath + '; injection skipped.');
    process.exit(1);
}

fs.writeFileSync(htmlPath, patched, 'utf-8');
console.log('Injected GitHub update handler into ' + htmlPath);
