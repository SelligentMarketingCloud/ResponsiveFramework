/**
 * Cloudflare Worker: user-authenticated GitHub App dispatch proxy for EOA baseline updates
 *
 * Expected environment variables/secrets:
 * - GITHUB_APP_CLIENT_ID (plain text)
 * - GITHUB_APP_CLIENT_SECRET (secret)
 * - AUTH_STATE_SECRET (secret used to sign OAuth state)
 * - ALLOWED_OWNER (plain text)
 * - ALLOWED_REPO (plain text)
 * - ALLOWED_ORIGIN (required for credentialed browser requests)
 *
 * Optional:
 * - GITHUB_APP_REDIRECT_URI (defaults to <worker-origin>/auth/callback)
 * - AUTH_COOKIE_NAME (defaults to eoa_gh_user_token)
 * - ALLOWED_COMPARE_URL_PREFIX (for custom GitHub Pages domains)
 */

const AUTH_COOKIE_NAME_DEFAULT = 'eoa_gh_user_token';
// 10 minutes OAuth state lifetime.
const AUTH_STATE_TTL_SECONDS = 10 * 60;
// Cap cookie lifetime to 8 hours even if token lives longer.
const AUTH_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;
// If GitHub does not return expires_in, keep session short (1 hour).
const AUTH_COOKIE_FALLBACK_MAX_AGE_SECONDS = 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(env, request.headers.get('Origin'));

    console.log(`[eoa-proxy] ${request.method} ${url.pathname}`);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === 'GET' && url.pathname === '/auth/start') {
      return handleAuthStart(request, env, corsHeaders);
    }

    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/auth/status') {
      return handleAuthStatus(request, env, corsHeaders);
    }

    if (request.method === 'POST' && url.pathname === '/auth/logout') {
      return handleLogout(env, corsHeaders);
    }

    if (request.method !== 'POST') {
      console.log(`[eoa-proxy] 405 method not allowed: ${request.method}`);
      return json({ message: 'Method not allowed' }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      console.log('[eoa-proxy] 400 invalid JSON payload');
      return json({ message: 'Invalid JSON payload' }, 400, corsHeaders);
    }

    const validationError = validateRequest(body, env);
    if (validationError) {
      console.log(`[eoa-proxy] 400 validation error: ${validationError}`);
      return json({ message: validationError }, 400, corsHeaders);
    }

    console.log(`[eoa-proxy] dispatch attempt: owner=${body.owner} repo=${body.repo} clientId=${body.client_payload?.clientId} branch=${body.client_payload?.branch}`);

    const auth = await readAuthenticatedUser(request, env, body.owner, body.repo);
    if (!auth.ok) {
      console.log(`[eoa-proxy] ${auth.status} auth failed: ${auth.message}`);
      return json(
        {
          message: auth.message,
          authUrl: auth.authUrl || buildAuthStartUrl(request.url),
        },
        auth.status,
        corsHeaders
      );
    }

    console.log(`[eoa-proxy] authenticated as ${auth.login}, dispatching event`);

    try {
      const dispatchRes = await fetch(
        `https://api.github.com/repos/${body.owner}/${body.repo}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: 'token ' + auth.token,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'eoa-github-user-proxy',
          },
          body: JSON.stringify({
            event_type: body.event_type,
            client_payload: body.client_payload,
          }),
        }
      );

      if (!dispatchRes.ok) {
        const dispatchBody = await dispatchRes.text();
        console.log(`[eoa-proxy] 502 GitHub dispatch failed (${dispatchRes.status}): ${dispatchBody}`);
        let userMessage = `GitHub dispatch failed (${dispatchRes.status})`;
        if (dispatchRes.status === 403 && dispatchBody.includes('Resource not accessible by integration')) {
          // GitHub returns "Resource not accessible by integration" when the GitHub App
          // installation lacks the permission required by the endpoint (contents:write for
          // repository_dispatch). Provide an actionable message instead of the raw API error.
          userMessage =
            'GitHub dispatch failed (403 Resource not accessible by integration): ' +
            'the GitHub App installation is missing the "Contents: Read & write" permission. ' +
            'Grant this permission in the GitHub App settings and re-install the app on the repository.';
        }
        return json(
          { message: userMessage, github: dispatchBody },
          502,
          corsHeaders
        );
      }

      console.log(`[eoa-proxy] 200 dispatch succeeded for actor=${auth.login}`);
      return json({ ok: true, actor: auth.login }, 200, corsHeaders);
    } catch (error) {
      console.log(`[eoa-proxy] 500 unhandled error: ${error.message}`);
      return json({ message: error.message || 'Unhandled error' }, 500, corsHeaders);
    }
  },
};

async function handleAuthStart(request, env, corsHeaders) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.AUTH_STATE_SECRET) {
    return json(
      { message: 'GITHUB_APP_CLIENT_ID and AUTH_STATE_SECRET are required for user auth' },
      500,
      corsHeaders
    );
  }

  const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN || '';
  const payload = {
    origin,
    exp: Math.floor(Date.now() / 1000) + AUTH_STATE_TTL_SECONDS,
  };
  const signedState = await signState(payload, env.AUTH_STATE_SECRET);

  const requestUrl = new URL(request.url);
  const redirectUri = env.GITHUB_APP_REDIRECT_URI || `${requestUrl.origin}/auth/callback`;

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'repo');
  authorizeUrl.searchParams.set('state', signedState);

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: authorizeUrl.toString(),
    },
  });
}

async function handleAuthCallback(request, env) {
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');

  if (!code || !state) {
    return authCallbackPage(false, null, 'Missing code or state');
  }

  let statePayload;
  try {
    statePayload = await verifyState(state, env.AUTH_STATE_SECRET);
  } catch (error) {
    return authCallbackPage(false, null, error.message || 'Invalid state');
  }

  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    return authCallbackPage(false, statePayload.origin, 'GitHub App OAuth secrets are not configured');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'eoa-github-user-proxy',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_APP_REDIRECT_URI || `${callbackUrl.origin}/auth/callback`,
    }),
  });

  let tokenBody;
  try {
    tokenBody = await tokenRes.json();
  } catch {
    return authCallbackPage(false, statePayload.origin, 'OAuth token exchange returned an invalid response body');
  }

  if (!tokenRes.ok || !tokenBody.access_token) {
    return authCallbackPage(false, statePayload.origin, tokenBody.error_description || 'OAuth token exchange failed');
  }

  const user = await getGithubUser(tokenBody.access_token);
  if (!user.ok) {
    return authCallbackPage(false, statePayload.origin, user.message || 'Could not load authenticated user');
  }

  const cookieName = env.AUTH_COOKIE_NAME || AUTH_COOKIE_NAME_DEFAULT;
  const expiresIn = Number(tokenBody.expires_in);
  const maxAge = Number.isFinite(expiresIn) && expiresIn > 0
    ? Math.min(expiresIn, AUTH_COOKIE_MAX_AGE_SECONDS)
    : AUTH_COOKIE_FALLBACK_MAX_AGE_SECONDS;

  return authCallbackPage(true, statePayload.origin, null, {
    login: user.login,
    token: tokenBody.access_token,
    setCookie: `${cookieName}=${encodeURIComponent(tokenBody.access_token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`,
  });
}

async function handleAuthStatus(request, env, corsHeaders) {
  const token = readTokenFromRequest(request, env);
  if (!token) {
    return json({ authenticated: false }, 200, corsHeaders);
  }

  const user = await getGithubUser(token);
  if (!user.ok) {
    return json({ authenticated: false }, 200, corsHeaders);
  }

  return json({ authenticated: true, login: user.login }, 200, corsHeaders);
}

function handleLogout(env, corsHeaders) {
  const cookieName = env.AUTH_COOKIE_NAME || AUTH_COOKIE_NAME_DEFAULT;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Set-Cookie': `${cookieName}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`,
    },
  });
}

async function readAuthenticatedUser(request, env, owner, repo) {
  const token = readTokenFromRequest(request, env);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: 'User authentication required',
      authUrl: buildAuthStartUrl(request.url),
    };
  }

  const user = await getGithubUser(token);
  if (!user.ok) {
    return {
      ok: false,
      status: 401,
      message: user.message || 'Could not validate user token',
      authUrl: buildAuthStartUrl(request.url),
    };
  }

  const access = await hasRepositoryWriteAccess(token, owner, repo);
  if (!access.ok) {
    return {
      ok: false,
      status: 403,
      message: access.message || `User ${user.login} does not have repository write access`,
    };
  }

  return {
    ok: true,
    token,
    login: user.login,
  };
}

function readTokenFromRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const cookieName = env.AUTH_COOKIE_NAME || AUTH_COOKIE_NAME_DEFAULT;
  const cookieHeader = request.headers.get('Cookie') || '';
  const tokenFromCookie = parseCookie(cookieHeader, cookieName);
  return tokenFromCookie ? decodeURIComponent(tokenFromCookie) : null;
}

async function getGithubUser(token) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'eoa-github-user-proxy',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      message: `GitHub user lookup failed (${response.status}): ${body}`,
    };
  }

  const data = await response.json();
  if (!data || !data.login) {
    return { ok: false, message: 'GitHub user lookup returned no login' };
  }

  return { ok: true, login: data.login };
}

async function hasRepositoryWriteAccess(token, owner, repo) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'eoa-github-user-proxy',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      message: `Repository access check failed (${response.status}): ${body}`,
    };
  }

  const data = await response.json();
  const permissions = data && data.permissions ? data.permissions : {};
  const canWrite = Boolean(permissions.push || permissions.maintain || permissions.admin);
  if (!canWrite) {
    return {
      ok: false,
      message: 'Authenticated user does not have push permissions in the repository',
    };
  }

  return { ok: true };
}

function buildCorsHeaders(env, requestOrigin) {
  const allowedOrigin = env.ALLOWED_ORIGIN || requestOrigin || '*';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (allowedOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function validateRequest(body, env) {
  if (!body || typeof body !== 'object') return 'Payload must be an object';

  if (body.owner !== env.ALLOWED_OWNER) {
    return `Owner "${body.owner}" is not allowed`;
  }

  if (body.repo !== env.ALLOWED_REPO) {
    return `Repository "${body.repo}" is not allowed`;
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

  const configuredPrefix = String(env.ALLOWED_COMPARE_URL_PREFIX || '').trim();
  const normalizedCompareUrl = `${parsedCompareUrl.origin}${parsedCompareUrl.pathname}`;
  const hasExpectedLocation = configuredPrefix
    ? normalizedCompareUrl.startsWith(configuredPrefix)
    : (
      parsedCompareUrl.protocol === 'https:' &&
      parsedCompareUrl.hostname === `${(env.ALLOWED_OWNER || '').toLowerCase()}.github.io` &&
      parsedCompareUrl.pathname.startsWith(`/${env.ALLOWED_REPO}/`)
    );

  if (!hasExpectedLocation || compareUrl.includes('..')) {
    return 'Invalid compareUrl';
  }

  return null;
}

async function signState(payload, secret) {
  if (!secret) {
    throw new Error('AUTH_STATE_SECRET is required');
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSign(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyState(state, secret) {
  if (!secret) {
    throw new Error('AUTH_STATE_SECRET is required');
  }

  const parts = String(state || '').split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid state format');
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = await hmacSign(secret, encodedPayload);
  if (!timingSafeEqual(expectedSignature, providedSignature)) {
    throw new Error('Invalid state signature');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new Error('Invalid state payload');
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('State has expired');
  }

  return payload;
}

async function hmacSign(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return arrayBufferToBase64Url(signature);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

function parseCookie(cookieHeader, key) {
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (name === key) return value;
  }
  return null;
}

function buildAuthStartUrl(requestUrl) {
  const parsed = new URL(requestUrl);
  parsed.pathname = '/auth/start';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function authCallbackPage(ok, origin, errorMessage, data = {}) {
  const targetOrigin = typeof origin === 'string' && origin ? origin : '*';
  const payload = {
    type: 'eoa-github-auth',
    ok,
    login: data.login || null,
    token: data.token || null,
    error: errorMessage || null,
  };

  const nonce = generateNonce();
  const script = `<!doctype html><html><body><script nonce="${nonce}">
    (function () {
      var payload = ${JSON.stringify(payload)};
      var targetOrigin = ${JSON.stringify(targetOrigin)};
      if (window.opener && typeof window.opener.postMessage === 'function') {
        window.opener.postMessage(payload, targetOrigin);
      }
      window.close();
    })();
  </script></body></html>`;

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };

  if (data.setCookie) {
    headers['Set-Cookie'] = data.setCookie;
  }

  return new Response(script, {
    status: ok ? 200 : 400,
    headers,
  });
}

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  return uint8ArrayToBase64Url(bytes);
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to a length divisible by 4 before atob decoding.
  const normalized = padded + '==='.slice((padded.length + 3) % 4);
  return atob(normalized);
}

function arrayBufferToBase64Url(buffer) {
  return uint8ArrayToBase64Url(new Uint8Array(buffer));
}

function uint8ArrayToBase64Url(bytes) {
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
