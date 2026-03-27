import { clearAuthCookies, getKeycloakLogoutUrl } from '$lib/server/keycloak';
import { redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies }) => {
  clearAuthCookies(cookies);
  throw redirect(302, getKeycloakLogoutUrl());
};
