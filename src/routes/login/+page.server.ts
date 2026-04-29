import { fail, redirect, type Actions, type PageServerLoad } from '@sveltejs/kit';
import { loginWithPassword, useDirectLogin } from '$lib/server/keycloak';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.session) {
    throw redirect(302, '/dashboard');
  }

  const next = url.searchParams.get('next') ?? '/dashboard';
  const directLogin = useDirectLogin();

  if (!directLogin) {
    throw redirect(302, `/auth/login?next=${encodeURIComponent(next)}`);
  }

  return {
    next,
    directLogin
  };
};

export const actions: Actions = {
  default: async ({ cookies, request, url }) => {
    if (!useDirectLogin()) {
      throw redirect(302, `/auth/login?next=${encodeURIComponent(url.searchParams.get('next') ?? '/dashboard')}`);
    }

    const formData = await request.formData();
    const username = String(formData.get('username') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '/dashboard');

    if (!username || !password) {
      return fail(400, {
        error: 'Username and password are required.',
        username,
        next,
        directLogin: true
      });
    }

    const ok = await loginWithPassword(cookies, username, password, next);
    if (!ok) {
      return fail(400, {
        error: 'Invalid username or password.',
        username,
        next,
        directLogin: true
      });
    }

    return { directLogin: true };
  }
};
