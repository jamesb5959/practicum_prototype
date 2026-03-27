import { redirect, type Handle } from '@sveltejs/kit';
import { clearAuthCookies, readSession } from '$lib/server/keycloak';

const protectedPaths = ['/dashboard', '/space_view'];

export const handle: Handle = async ({ event, resolve }) => {
  const session = readSession(event.cookies);

  if (session) {
    event.locals.session = session;
  } else {
    clearAuthCookies(event.cookies);
    event.locals.session = null;
  }

  const { pathname } = event.url;
  const isProtectedPath = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtectedPath && !event.locals.session) {
    throw redirect(302, `/login?next=${encodeURIComponent(pathname)}`);
  }

  if (pathname === '/login' && event.locals.session) {
    throw redirect(302, '/dashboard');
  }

  return resolve(event);
};
