<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    goto('/login');
  });
</script>

<div style="padding: 24px; color: var(--muted);">
  Redirecting to login...
</div>
