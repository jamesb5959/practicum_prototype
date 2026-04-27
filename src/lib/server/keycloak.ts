import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createHash, randomBytes } from 'node:crypto';
import { redirect, type Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'kc_demo_session';

const keycloakBaseUrl = env.KEYCLOAK_BASE_URL ?? 'http://localhost:8080';
const keycloakInternalUrl = env.KEYCLOAK_INTERNAL_URL ?? keycloakBaseUrl;
const realm = env.KEYCLOAK_REALM ?? 'demo';
const clientId = env.KEYCLOAK_CLIENT_ID ?? 'svelte-web';
const appBaseUrl = env.APP_BASE_URL ?? 'http://localhost:5173';
const loginStateStore = new Map<string, { codeVerifier: string; returnTo: string; expiresAt: number }>();

export type SessionUser = {
  username: string;
  email?: string;
  name?: string;
};

export type Session = {
  user: SessionUser;
  expiresAt: number;
  idToken: string;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  id_token: string;
  token_type: string;
};

type TokenClaims = {
  preferred_username?: string;
  email?: string;
  name?: string;
};

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getRealmName() {
  return realm;
}

export function getClientId() {
  return clientId;
}

export function getKeycloakLogoutUrl() {
  const url = new URL(`${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/logout`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('post_logout_redirect_uri', `${appBaseUrl}/login`);
  return url.toString();
}

export function useDirectLogin() {
  return (env.KEYCLOAK_DIRECT_LOGIN ?? 'false').toLowerCase() === 'true';
}

export function readSession(cookies: Cookies): Session | null {
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Session;
    if (!session?.expiresAt || session.expiresAt <= Date.now()) {
      return null;
    }
    if (!session?.user?.username || !session?.idToken) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearAuthCookies(cookies: Cookies) {
  for (const name of [SESSION_COOKIE]) {
    cookies.delete(name, {
      path: '/'
    });
  }
}

export function startLogin(cookies: Cookies, returnTo: string) {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pruneLoginStateStore();
  loginStateStore.set(state, {
    codeVerifier,
    returnTo,
    expiresAt
  });

  const url = new URL(`${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${appBaseUrl}/auth/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  throw redirect(302, url.toString());
}

export async function finishLogin(cookies: Cookies, url: URL) {
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  pruneLoginStateStore();
  const loginState = returnedState ? loginStateStore.get(returnedState) : null;

  if (!code || !returnedState || !loginState || loginState.expiresAt <= Date.now()) {
    clearAuthCookies(cookies);
    throw redirect(302, '/login?error=Missing%20login%20state');
  }
  loginStateStore.delete(returnedState);

  const response = await fetch(
    `${keycloakInternalUrl}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: `${appBaseUrl}/auth/callback`,
        code_verifier: loginState.codeVerifier
      })
    }
  );

  if (!response.ok) {
    clearAuthCookies(cookies);
    throw redirect(302, '/login?error=Token%20exchange%20failed');
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  setSessionCookie(cookies, tokenResponse);

  throw redirect(302, safeReturnTo(loginState.returnTo));
}

export async function loginWithPassword(
  cookies: Cookies,
  username: string,
  password: string,
  returnTo: string
) {
  const response = await fetch(
    `${keycloakInternalUrl}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        username,
        password,
        scope: 'openid profile email'
      })
    }
  );

  if (!response.ok) {
    clearAuthCookies(cookies);
    return false;
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  setSessionCookie(cookies, tokenResponse);
  throw redirect(302, safeReturnTo(returnTo));
}

function cookieOptions(maxAge: number) {
  const useSecureCookies = !dev && appBaseUrl.startsWith('https://');
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: useSecureCookies,
    path: '/',
    maxAge
  };
}

function safeReturnTo(returnTo: string) {
  return returnTo.startsWith('/') ? returnTo : '/dashboard';
}

function decodeJwt(token: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid token');
  }

  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as TokenClaims;
}

function setSessionCookie(cookies: Cookies, tokenResponse: TokenResponse) {
  const claims = decodeJwt(tokenResponse.id_token);
  const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

  const session: Session = {
    user: {
      username: claims.preferred_username ?? claims.email ?? 'user',
      email: claims.email,
      name: claims.name
    },
    expiresAt,
    idToken: tokenResponse.id_token
  };

  cookies.set(SESSION_COOKIE, JSON.stringify(session), cookieOptions(tokenResponse.expires_in));
}

function pruneLoginStateStore() {
  const now = Date.now();
  for (const [state, value] of loginStateStore.entries()) {
    if (value.expiresAt <= now) {
      loginStateStore.delete(state);
    }
  }
}
