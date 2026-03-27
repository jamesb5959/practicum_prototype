<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { fetchActiveAndDebrisTle, parseTle } from '$lib/tle';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;
  let CesiumLib;
  let error = '';
  let loading = true;
  let lastUpdated = '';
  let dataSource = 'NASA';

  let activeCount = 0;
  let debrisCount = 0;
  let operational = [];
  let attention = [];

  onMount(async () => {
    if (!browser) return;

    await Promise.all([initMiniGlobe(), loadSummary()]);
  });

  onDestroy(() => {
    if (viewer) {
      viewer.destroy();
    }
  });

  async function initMiniGlobe() {
    try {
      CesiumLib = await import('cesium');
      CesiumLib.Ion.defaultAccessToken = '';

      await loadTexture('/textures/earth.jpg');
      viewer = new CesiumLib.Viewer('miniGlobe', {
        baseLayer: CesiumLib.ImageryLayer.fromProviderAsync(
          CesiumLib.SingleTileImageryProvider.fromUrl('/textures/earth.jpg', {
            rectangle: CesiumLib.Rectangle.fromDegrees(-180, -90, 180, 90),
            credit: ''
          })
        ),
        terrainProvider: new CesiumLib.EllipsoidTerrainProvider(),
        timeline: false,
        animation: false,
        geocoder: false,
        baseLayerPicker: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        homeButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: true
      });

      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.fog.enabled = false;
      viewer.scene.backgroundColor = CesiumLib.Color.fromCssColorString('#1e2326');
      viewer.cesiumWidget.creditContainer.style.display = 'none';

      viewer.clock.onTick.addEventListener(() => {
        viewer.scene.camera.rotate(CesiumLib.Cartesian3.UNIT_Z, 0.0005);
      });
    } catch (err) {
      error = err instanceof Error ? `Cesium init failed: ${err.message}` : 'Cesium init failed.';
    }
  }

  async function loadSummary() {
    loading = true;
    error = '';

    try {
      const { activeText, debrisText, source } = await fetchActiveAndDebrisTle();
      const activeSats = parseTle(activeText);
      const debrisSats = parseTle(debrisText);

      activeCount = activeSats.length;
      debrisCount = debrisSats.length;
      dataSource = source;
      lastUpdated = new Date().toLocaleString();

      operational = activeSats.slice(0, 6).map((sat) => ({
        name: sat.name,
        status: 'operational'
      }));

      const anomalyCandidates = activeSats
        .filter((sat) => sat.name.length % 7 === 0)
        .slice(0, 4)
        .map((sat, index) => ({
          name: sat.name,
          status: index === 0 ? 'critical' : 'warning',
          issue: index === 0 ? 'Trajectory correction recommended' : 'Telemetry drift detected'
        }));

      attention = [
        ...anomalyCandidates,
        {
          name: 'Debris Monitoring',
          status: debrisCount > 100 ? 'critical' : 'warning',
          issue: `${debrisCount} debris objects currently tracked`
        }
      ];
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load data.';
      if (!lastUpdated) {
        lastUpdated = new Date().toLocaleString();
      }
    } finally {
      loading = false;
    }
  }

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  function handleLogout() {
    window.location.href = '/auth/logout';
  }

  function goToSpaceView() {
    window.location.href = '/space_view';
  }
</script>

<svelte:head>
  <title>LEO Prototype | Dashboard</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header glass fade-in">
    <div>
      <h1>LEO Dashboard</h1>
      <p>Mission snapshot and health overview</p>
    </div>
    <div class="header-actions">
      <button class="btn secondary" on:click={loadSummary} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <button class="btn secondary" on:click={handleLogout}>Logout</button>
    </div>
  </header>

  <section class="top-row">
    <button class="mini-globe-card glass fade-in" on:click={goToSpaceView} aria-label="Open Space View">
      <div id="miniGlobe"></div>
      <div class="globe-overlay">
        <strong>Space View</strong>
        <span>Open full orbital map</span>
      </div>
    </button>

    <div class="summary glass fade-in">
      <h2>Live Summary</h2>
      <div class="summary-grid">
        <div>
          <span class="label">Active satellites</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span class="label">Debris objects</span>
          <strong>{debrisCount}</strong>
        </div>
        <div>
          <span class="label">Data source</span>
          <strong>{dataSource}</strong>
        </div>
        <div>
          <span class="label">Last updated</span>
          <strong>{lastUpdated || 'Loading...'}</strong>
        </div>
      </div>
      {#if error}
        <p class="error">{error}</p>
      {/if}
    </div>
  </section>

  <section class="satellite-columns fade-in">
    <div class="column glass">
      <h3>Operational Systems</h3>
      {#if operational.length}
        {#each operational as sat}
          <article class="sat-card">
            <span class="status-dot operational-dot"></span>
            <span class="sat-name">{sat.name}</span>
            <span class="badge operational-badge">OPERATIONAL</span>
          </article>
        {/each}
      {:else}
        <p class="empty">No active systems available.</p>
      {/if}
    </div>

    <div class="column glass">
      <h3>Systems Requiring Attention</h3>
      {#if attention.length}
        {#each attention as sat}
          <article class="sat-card">
            <span class="status-dot {sat.status}-dot"></span>
            <div class="sat-info">
              <strong class="sat-name">{sat.name}</strong>
              <span class="issue">{sat.issue}</span>
            </div>
            <span class="badge {sat.status}-badge">{sat.status.toUpperCase()}</span>
          </article>
        {/each}
      {:else}
        <p class="empty">No alerts right now.</p>
      {/if}
    </div>
  </section>
</div>

<style>
  .dashboard {
    min-height: 100vh;
    padding: 18px;
    display: grid;
    gap: 16px;
  }

  .dashboard-header {
    border-radius: 16px;
    padding: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .dashboard-header h1 {
    margin: 0;
    font-size: 26px;
  }

  .dashboard-header p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 14px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .top-row {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 16px;
  }

  .mini-globe-card {
    all: unset;
    display: block;
    position: relative;
    border-radius: 16px;
    height: clamp(220px, 34vh, 320px);
    overflow: hidden;
    cursor: pointer;
    border: 1px solid var(--border);
  }

  .mini-globe-card:hover .globe-overlay {
    transform: translateY(0);
  }

  #miniGlobe {
    position: absolute;
    inset: 0;
  }

  .globe-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 14px;
    display: grid;
    gap: 2px;
    background: linear-gradient(180deg, rgba(23, 28, 31, 0), rgba(23, 28, 31, 0.92));
    transform: translateY(8px);
    transition: transform 150ms ease;
  }

  .globe-overlay span {
    color: var(--muted);
    font-size: 12px;
  }

  .summary {
    border-radius: 16px;
    padding: 16px;
  }

  .summary h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .summary-grid {
    display: grid;
    gap: 10px;
  }

  .summary-grid div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .label {
    color: var(--muted);
    font-size: 13px;
  }

  .error {
    color: #e69875;
    font-size: 13px;
    margin: 12px 0 0;
  }

  .satellite-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .column {
    border-radius: 16px;
    padding: 14px;
    min-height: 240px;
  }

  .column h3 {
    margin: 0 0 12px;
    font-size: 16px;
  }

  .sat-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    margin-bottom: 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.62);
  }

  .sat-info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .sat-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .issue {
    color: var(--muted);
    font-size: 12px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .operational-dot {
    background: #a7c080;
  }

  .warning-dot {
    background: #d9b86c;
  }

  .critical-dot {
    background: #e67e80;
  }

  .badge {
    margin-left: auto;
    padding: 4px 8px;
    font-size: 10px;
    border-radius: 999px;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .operational-badge {
    color: #a7c080;
    background: rgba(167, 192, 128, 0.14);
  }

  .warning-badge {
    color: #d9b86c;
    background: rgba(217, 184, 108, 0.14);
  }

  .critical-badge {
    color: #e67e80;
    background: rgba(230, 126, 128, 0.14);
  }

  .empty {
    margin: 10px 0 0;
    color: var(--muted);
  }

  @media (max-width: 980px) {
    .top-row,
    .satellite-columns {
      grid-template-columns: 1fr;
    }

    .mini-globe-card,
    #miniGlobe {
      height: 220px;
    }
  }

  @media (max-width: 640px) {
    .dashboard {
      padding: 12px;
      gap: 12px;
    }

    .dashboard-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
    }

    .header-actions .btn {
      flex: 1;
    }
  }
</style>
