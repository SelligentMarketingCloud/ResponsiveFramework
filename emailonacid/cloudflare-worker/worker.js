/**
 * Cloudflare Worker: GitHub App dispatch proxy for EOA baseline updates
 *
 * Expected environment variables/secrets:
 * - GITHUB_APP_ID (plain text)
 * - GITHUB_INSTALLATION_ID (plain text)
 * - GITHUB_APP_PRIVATE_KEY_PEM (secret, full PEM with BEGIN/END lines)
 * - ALLOWED_OWNER (plain text)
 * - ALLOWED_REPO (plain text)
 * - ALLOWED_ORIGIN (optional, defaults to '*')
 */

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed' }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: 'Invalid JSON payload' }, 400, corsHeaders);
    }

    const validationError = validateRequest(body, env);
    if (validationError) {
      return json({ message: validationError }, 400, corsHeaders);
    }

    try {
      const appJwt = await createAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY_PEM);
      const installationToken = await createInstallationToken(appJwt, env.GITHUB_INSTALLATION_ID);

      const dispatchRes = await fetch(
        `https://api.github.com/repos/${body.owner}/${body.repo}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + installationToken,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'eoa-github-app-proxy',
          },
          body: JSON.stringify({
            event_type: body.event_type,
            client_payload: body.client_payload,
          }),
        }
      );

      if (!dispatchRes.ok) {
        const dispatchBody = await dispatchRes.text();
        return json(
          { message: `GitHub dispatch failed (${dispatchRes.status})`, github: dispatchBody },
          502,
          corsHeaders
        );
      }

      return json({ ok: true }, 200, corsHeaders);
    } catch (error) {
      return json({ message: error.message || 'Unhandled error' }, 500, corsHeaders);
    }
  },
};

function buildCorsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function validateRequest(body, env) {
  if (!body || typeof body !== 'object') return 'Payload must be an object';

  if (body.owner !== env.ALLOWED_OWNER || body.repo !== env.ALLOWED_REPO) {
    return 'Repository is not allowed';
  }

  if (body.event_type !== 'eoa-update-baseline') {
    return 'Invalid event_type';
  }

  if (!body.client_payload || typeof body.client_payload !== 'object') {
    return 'Missing client_payload';
  }

  const { clientId, branch, compareUrl } = body.client_payload;

  if (!/^[A-Za-z0-9_-]+$/.test(String(clientId || ''))) {
    return 'Invalid clientId';
  }

  const branchString = String(branch || '');
  // Git refs may include "/" (e.g. feature/foo), but disallow traversal-like patterns.
  const branchLooksSafe =
    /^[A-Za-z0-9_./-]+$/.test(branchString) &&
    !branchString.startsWith('/') &&
    !branchString.includes('..') &&
    !branchString.includes('//');
  if (!branchLooksSafe) {
    return 'Invalid branch';
  }

  if (typeof compareUrl !== 'string') {
    return 'Invalid compareUrl';
  }

  let parsedCompareUrl;
  try {
    parsedCompareUrl = new URL(compareUrl);
  } catch {
    return 'Invalid compareUrl';
  }

  const expectedHost = `${env.ALLOWED_OWNER}.github.io`;
  const expectedPathPrefix = `/${env.ALLOWED_REPO}/`;
  const hasExpectedLocation =
    parsedCompareUrl.protocol === 'https:' &&
    parsedCompareUrl.hostname === expectedHost &&
    parsedCompareUrl.pathname.startsWith(expectedPathPrefix);
  // Keep the raw-string ".." check: URL parsing normalizes path segments, so
  // traversal-like input could be hidden in pathname after normalization.
  if (!hasExpectedLocation || compareUrl.includes('..')) {
    return 'Invalid compareUrl';
  }

  return null;
}

async function createInstallationToken(appJwt, installationId) {
  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + appJwt,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'eoa-github-app-proxy',
      },
    }
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Failed to create installation token (${tokenRes.status}): ${body}`);
  }

  const data = await tokenRes.json();
  if (!data.token) {
    throw new Error('GitHub installation token was missing from response');
  }

  return data.token;
}

async function createAppJwt(appId, privateKeyPem) {
  if (!appId || !privateKeyPem) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PEM are required');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    // Backdate by 60s to tolerate small clock differences between systems.
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${arrayBufferToBase64Url(signature)}`;
}

async function importPrivateKey(pem) {
  const cleanPem = pem
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  let binaryDer;
  try {
    binaryDer = Uint8Array.from(atob(cleanPem), c => c.charCodeAt(0));
  } catch {
    throw new Error(
      'Invalid GITHUB_APP_PRIVATE_KEY_PEM format. Expected PEM content with BEGIN/END markers.'
    );
  }

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
