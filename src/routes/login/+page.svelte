<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { isAuthenticated, login } from '$lib/auth';

  let username = '';
  let password = '';
  let error = '';
  let step = 'login';
  let mfaCode = '';

  onMount(() => {
    if (isAuthenticated()) {
      goto('/dashboard');
    }
  });

  function handleSubmit() {
    error = '';
    const ok = login(username, password);
    if (ok) {
      step = 'mfa';
    } else {
      error = 'Invalid credentials. Try admin / admin.';
    }
  }

  function handleMfa() {
    error = '';
    if (mfaCode.trim() === '123456') {
      goto('/dashboard');
    } else {
      error = 'Invalid MFA code. Try 123456.';
    }
  }
</script>

<svelte:head>
  <title>LEO Prototype | Login</title>
</svelte:head>

<div class="login-page">
  <div class="login-card glass fade-in">
    <div class="login-header">
      <h1>LEO Prototype</h1>
      <p>Practicum LEO Trajectory Prototype.</p>
    </div>

    {#if step === 'login'}
      <form on:submit|preventDefault={handleSubmit}>
        <label>
          <span>Username</span>
          <input class="input" type="text" bind:value={username} autocomplete="username" />
        </label>

        <label>
          <span>Password</span>
          <input class="input" type="password" bind:value={password} autocomplete="current-password" />
        </label>

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <button class="btn" type="submit">Login</button>
      </form>
    {:else}
      <form on:submit|preventDefault={handleMfa}>
        <label>
          <span>Enter MFA code</span>
          <input class="input" type="text" bind:value={mfaCode} inputmode="numeric" />
        </label>

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <button class="btn" type="submit">Verify</button>
        <button class="btn secondary" type="button" on:click={() => (step = 'login')}>
          Back
        </button>
      </form>
      <div class="hint">
        Prototype MFA code: <strong>123456</strong>
      </div>
    {/if}

    {#if step === 'login'}
      <div class="hint">
        Default credentials: <strong>admin / admin</strong>
      </div>
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
    margin: 0 0 8px 0;
    font-size: 28px;
    letter-spacing: 0.4px;
  }

  .login-header p {
    margin: 0 0 20px 0;
    color: var(--muted);
  }

  form {
    display: grid;
    gap: 14px;
  }

  label {
    display: grid;
    gap: 8px;
    color: var(--muted);
    font-size: 14px;
  }

  .error {
    color: #ff8797;
    font-size: 14px;
  }

  .hint {
    margin-top: 16px;
    color: var(--muted);
    font-size: 13px;
  }
</style>
