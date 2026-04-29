import { finishLogin } from '$lib/server/keycloak';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
  await finishLogin(cookies, url);
};
