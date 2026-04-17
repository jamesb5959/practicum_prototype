import { redirect, type PageServerLoad } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.session) {
    throw redirect(302, '/dashboard');
  }

  const next = url.searchParams.get('next') ?? '/dashboard';
  throw redirect(302, `/auth/login?next=${encodeURIComponent(next)}`);
};
