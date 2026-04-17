<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import {
    CLASSIFICATION_LEVELS,
    activeClassification,
    initClassification,
    setClassification
  } from '$lib/classification';

  const CLASSIFICATION_PASSWORD = 'admin';
  let dropdownOpen = false;
  let passwordPromptOpen = false;
  let passwordInput = '';
  let passwordError = '';
  let pendingClassification = 'UNCLASSIFIED';

  onMount(() => {
    initClassification();
    void fetch('/api/tle-prediction?warmup=1').catch(() => {});
  });

  function selectClassification(level) {
    dropdownOpen = false;
    if (level === $activeClassification) return;
    if (level === 'UNCLASSIFIED') {
      setClassification(level);
      return;
    }
    pendingClassification = level;
    passwordInput = '';
    passwordError = '';
    passwordPromptOpen = true;
  }

  function submitClassificationPassword() {
    if (passwordInput !== CLASSIFICATION_PASSWORD) {
      passwordError = 'Incorrect password.';
      return;
    }
    setClassification(pendingClassification);
    passwordPromptOpen = false;
    passwordInput = '';
    passwordError = '';
  }

  function closePasswordPrompt() {
    passwordPromptOpen = false;
    passwordInput = '';
    passwordError = '';
  }
</script>

<div class="classification-shell">
  <button
    class="classification-bar {$activeClassification.toLowerCase()}"
    on:click={() => (dropdownOpen = !dropdownOpen)}
    aria-label="Change classification level"
    aria-expanded={dropdownOpen}
  >
    {$activeClassification}
  </button>

  {#if dropdownOpen}
    <div class="classification-menu glass">
      {#each CLASSIFICATION_LEVELS as level}
        <button
          class="classification-option"
          class:active={level === $activeClassification}
          on:click={() => selectClassification(level)}
        >
          {level}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if passwordPromptOpen}
  <div class="classification-backdrop">
    <form class="classification-modal glass" on:submit|preventDefault={submitClassificationPassword}>
      <h3>Restricted Classification</h3>
      <p>Enter password to switch to {pendingClassification}.</p>
      <input
        type="password"
        class="classification-input"
        placeholder="Password"
        bind:value={passwordInput}
      />
      {#if passwordError}
        <div class="classification-error">{passwordError}</div>
      {/if}
      <div class="classification-actions">
        <button type="button" class="btn secondary" on:click={closePasswordPrompt}>Cancel</button>
        <button type="submit" class="btn">Continue</button>
      </div>
    </form>
  </div>
{/if}

<slot />

<style>
  .classification-shell {
    position: sticky;
    top: 0;
    z-index: 200;
  }

  .classification-bar {
    width: 100%;
    height: var(--classification-bar-height);
    border: 0;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    cursor: pointer;
    color: #171c1f;
  }

  .classification-bar.unclassified {
    background: #a7c080;
  }

  .classification-bar.cui {
    background: #d8a657;
  }

  .classification-bar.classified {
    background: #e67e80;
  }

  .classification-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 220px;
    padding: 8px;
    border-radius: 12px;
    display: grid;
    gap: 6px;
  }

  .classification-option {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(24, 29, 31, 0.78);
    color: var(--fg);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .classification-option.active {
    border-color: var(--accent);
    background: rgba(127, 187, 179, 0.18);
  }

  .classification-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 22, 20, 0.42);
    display: grid;
    place-items: center;
    z-index: 260;
  }

  .classification-modal {
    width: min(360px, 92vw);
    padding: 16px;
    border-radius: 14px;
    display: grid;
    gap: 10px;
  }

  .classification-modal h3 {
    margin: 0;
    font-size: 16px;
  }

  .classification-modal p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  .classification-input {
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.74);
    color: var(--fg);
    border-radius: 10px;
    padding: 9px 10px;
    font-size: 13px;
    outline: none;
  }

  .classification-input:focus {
    border-color: var(--accent);
  }

  .classification-error {
    color: #e69875;
    font-size: 12px;
  }

  .classification-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
