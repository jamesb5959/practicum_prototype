import { startLogin } from '$lib/server/keycloak';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
  const returnTo = url.searchParams.get('next') ?? '/dashboard';
  startLogin(cookies, returnTo);
};
