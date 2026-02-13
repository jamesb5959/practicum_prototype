<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { isAuthenticated, login } from '$lib/auth';

  let username = '';
  let password = '';
  let error = '';

  onMount(() => {
    if (isAuthenticated()) {
      goto('/dashboard');
    }
  });

  function handleSubmit() {
    error = '';
    const ok = login(username, password);
    if (ok) {
      goto('/dashboard');
    } else {
      error = 'Invalid credentials. Try admin / admin.';
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

    <div class="hint">
      Default credentials: <strong>admin / admin</strong>
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
