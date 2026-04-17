<script lang="ts">
  import { page } from '$app/state';

  const error = page.url.searchParams.get('error') ?? '';
  const next = page.url.searchParams.get('next') ?? '/dashboard';
</script>

<svelte:head>
  <title>LEO Prototype | Login</title>
</svelte:head>

<div class="login-page">
  <div class="login-card glass fade-in">
    <div class="login-header">
      <h1>LEO Prototype</h1>
      <p>Authenticate through the local Keycloak demo server.</p>
    </div>

    {#if error}
      <div class="error">{decodeURIComponent(error)}</div>
    {/if}

    <a
      class="btn sign-in-link"
      href={`/auth/login?next=${encodeURIComponent(next)}`}
      data-sveltekit-reload
    >
      Sign in with Keycloak
    </a>

    <div class="hint">
      Demo realm user: <strong>admin / Admin123!</strong>
    </div>
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
    margin: 0 0 8px 0;
    font-size: 28px;
    letter-spacing: 0.4px;
  }

  .login-header p {
    margin: 0 0 20px 0;
    color: var(--muted);
  }

  .error {
    color: #e69875;
    font-size: 14px;
    margin-bottom: 14px;
  }

  .hint {
    margin-top: 16px;
    color: var(--muted);
    font-size: 13px;
  }

  .sign-in-link {
    display: inline-flex;
    width: 100%;
    justify-content: center;
    text-decoration: none;
  }
</style>
