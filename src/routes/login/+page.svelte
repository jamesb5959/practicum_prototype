<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let directLogin = $derived(data.directLogin ?? false);
  let error = $derived(form?.error ?? page.url.searchParams.get('error') ?? '');
  let next = $derived(form?.next ?? data.next ?? page.url.searchParams.get('next') ?? '/dashboard');
  let username = $derived(form?.username ?? '');
</script>

<svelte:head>
  <title>Real-Time Conjunction Analyzer | Login</title>
</svelte:head>

<div class="login-page">
  <div class="login-card glass fade-in">
    <div class="login-header">
      <h1>Real-Time Conjunction Analyzer</h1>
      <div class="login-logos" aria-label="Partner logos">
        <img src="/logos/UTEP_Classic_Logo.svg" alt="UTEP logo" class="login-logo utep-logo" />
        <img src="/logos/space-force.png" alt="United States Space Force logo" class="login-logo space-force-logo" />
      </div>
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
    width: min(560px, 94vw);
    padding: 36px;
    border-radius: 20px;
  }

  .login-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 22px;
  }

  .login-header h1 {
    margin: 0;
    font-size: 28px;
    letter-spacing: 0.4px;
    max-width: 340px;
  }

  .login-logos {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    flex: 0 0 auto;
  }

  .login-logo {
    display: block;
    object-fit: contain;
    filter: drop-shadow(0 6px 12px rgba(16, 22, 20, 0.24));
  }

  .utep-logo {
    height: 41px;
    width: auto;
  }

  .space-force-logo {
    height: 42px;
    width: auto;
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

  @media (max-width: 640px) {
    .login-card {
      width: min(480px, 94vw);
      padding: 28px;
    }

    .login-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .login-header h1 {
      max-width: none;
    }

    .login-logos {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }
</style>
