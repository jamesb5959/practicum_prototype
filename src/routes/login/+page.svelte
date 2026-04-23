<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const directLogin = data.directLogin ?? false;
  const error = form?.error ?? page.url.searchParams.get('error') ?? '';
  const next = form?.next ?? data.next ?? page.url.searchParams.get('next') ?? '/dashboard';
  const username = form?.username ?? '';
</script>

<svelte:head>
  <title>Real-Time Conjunction Analyzer | Login</title>
</svelte:head>

<div class="login-page">
  <div class="login-card glass fade-in">
    <div class="login-header">
      <h1>Real-Time Conjunction Analyzer</h1>
    </div>

    {#if error}
      <div class="error">{decodeURIComponent(error)}</div>
    {/if}

    {#if directLogin}
      <form method="POST" class="login-form">
        <input type="hidden" name="next" value={next} />
        <label class="field">
          <span>Username</span>
          <input name="username" type="text" value={username} autocomplete="username" />
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" />
        </label>
        <button class="btn sign-in-link" type="submit">Sign in</button>
      </form>
    {:else}
      <a
        class="btn sign-in-link"
        href={`/auth/login?next=${encodeURIComponent(next)}`}
        data-sveltekit-reload
      >
        Sign in with Keycloak
      </a>
    {/if}
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .login-card {
    width: min(420px, 92vw);
    padding: 32px;
    border-radius: 20px;
  }

  .login-header h1 {
    margin: 0 0 20px 0;
    font-size: 28px;
    letter-spacing: 0.4px;
  }

  .error {
    color: #e69875;
    font-size: 14px;
    margin-bottom: 14px;
  }

  .login-form {
    display: grid;
    gap: 14px;
  }

  .field {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }

  .field input {
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.74);
    color: var(--fg);
    border-radius: 10px;
    padding: 11px 12px;
    font-size: 14px;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .sign-in-link {
    display: inline-flex;
    width: 100%;
    justify-content: center;
    text-decoration: none;
  }
</style>
