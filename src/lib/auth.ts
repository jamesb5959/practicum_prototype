import { browser } from '$app/environment';

const TOKEN_KEY = 'satviz_token';

export function isAuthenticated(): boolean {
  if (!browser) return false;
  return localStorage.getItem(TOKEN_KEY) !== null;
}

export function login(username: string, password: string): boolean {
  const ok = username === 'admin' && password === 'admin';
  if (ok && browser) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ issued: Date.now() }));
  }
  return ok;
}

export function logout(): void {
  if (browser) {
    localStorage.removeItem(TOKEN_KEY);
  }
}
