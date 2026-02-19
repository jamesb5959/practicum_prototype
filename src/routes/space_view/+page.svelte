<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { isAuthenticated, logout } from '$lib/auth';
  import { fetchActiveTle, parseTle, propagateToGeodetic } from '$lib/tle';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;
  let CesiumLib;
  let loading = false;
  let error = '';
  let lastUpdated = '';
  let satelliteCount = 0;
  let dataSource = 'NASA';
  let refreshTimer;
  let positionTimer;

  let allSatellites = [];
  let tracked = [];
  let displayCount = 10;
  let trajectoryHours = 24;
  const LEO_MAX_KM = 2000;

  onMount(async () => {
    if (!isAuthenticated()) {
      goto('/login');
      return;
    }

    if (!browser) return;

    try {
      CesiumLib = await import('cesium');
      CesiumLib.Ion.defaultAccessToken = '';

      const textureInfo = await loadTexture('/textures/earth.png');
      viewer = new CesiumLib.Viewer('cesiumContainer', {
        imageryProvider: new CesiumLib.SingleTileImageryProvider({
          url: textureInfo.url,
          tileWidth: textureInfo.width,
          tileHeight: textureInfo.height,
          credit: ''
        }),
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
    } catch (err) {
      error =
        err instanceof Error
          ? `Cesium init failed: ${err.message}`
          : 'Cesium init failed.';
      lastUpdated = new Date().toLocaleString();
      return;
    }

    viewer.scene.globe.enableLighting = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.globe.baseColor = CesiumLib.Color.fromCssColorString('#0b1020');
    viewer.scene.backgroundColor = CesiumLib.Color.BLACK;
    viewer.cesiumWidget.creditContainer.style.display = 'none';

    await loadData();

    refreshTimer = setInterval(loadData, 10 * 60 * 1000);
    positionTimer = setInterval(updatePositions, 5000);
  });

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  onDestroy(() => {
    clearInterval(refreshTimer);
    clearInterval(positionTimer);
    if (viewer) {
      viewer.destroy();
    }
  });

  async function loadData() {
    if (!viewer) return;
    loading = true;
    error = '';
    try {
      const { text, source } = await fetchActiveTle();
      const sats = parseTle(text);
      dataSource = source;
      lastUpdated = new Date().toLocaleString();
      allSatellites = sats.filter((sat) => {
        const geo = propagateToGeodetic(sat.satrec, new Date());
        return geo && geo.altKm <= LEO_MAX_KM;
      });
      satelliteCount = allSatellites.length;
      rebuildEntities();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load data.';
      if (!lastUpdated) {
        lastUpdated = new Date().toLocaleString();
      }
    } finally {
      loading = false;
    }
  }

  function updatePositions() {
    if (!viewer || !CesiumLib) return;
    const now = new Date();
    for (const item of tracked) {
      const geo = propagateToGeodetic(item.satrec, now);
      if (!geo) continue;
      item.entity.position = CesiumLib.Cartesian3.fromDegrees(
        geo.lon,
        geo.lat,
        geo.altKm * 1000
      );
    }
  }

  function buildTrajectory(satrec, hours) {
    const positions = [];
    const now = Date.now();
    const totalMs = hours * 60 * 60 * 1000;
    const steps = Math.min(160, Math.max(16, Math.floor(hours / 3)));
    for (let i = 0; i <= steps; i += 1) {
      const time = new Date(now + (totalMs * i) / steps);
      const geo = propagateToGeodetic(satrec, time);
      if (!geo) continue;
      positions.push(
        CesiumLib.Cartesian3.fromDegrees(geo.lon, geo.lat, geo.altKm * 1000)
      );
    }
    return positions;
  }

  function rebuildEntities() {
    if (!viewer || !CesiumLib) return;
    viewer.entities.removeAll();
    tracked = [];
    const count = Math.min(displayCount, allSatellites.length);
    for (let i = 0; i < count; i += 1) {
      const sat = allSatellites[i];
      const geo = propagateToGeodetic(sat.satrec, new Date());
      if (!geo) continue;
      const position = CesiumLib.Cartesian3.fromDegrees(
        geo.lon,
        geo.lat,
        geo.altKm * 1000
      );
      const entity = viewer.entities.add({
        name: sat.name,
        position,
        point: {
          pixelSize: 4,
          color: CesiumLib.Color.CYAN,
          outlineColor: CesiumLib.Color.BLACK,
          outlineWidth: 1
        }
      });
      const trajectory = viewer.entities.add({
        polyline: {
          positions: buildTrajectory(sat.satrec, trajectoryHours),
          width: 1.5,
          material: CesiumLib.Color.CYAN.withAlpha(0.45)
        }
      });
      tracked.push({ satrec: sat.satrec, entity, trajectory });
    }
    updatePositions();
  }

  function handleLogout() {
    logout();
    goto('/login');
  }

  $: if (viewer && CesiumLib && allSatellites.length) {
    displayCount;
    trajectoryHours;
    rebuildEntities();
  }
</script>

<svelte:head>
  <title>LEO Prototype | Space View</title>
</svelte:head>

<div class="space_view">
  <div id="cesiumContainer"></div>

  <div class="overlay glass fade-in">
    <div class="overlay-header">
      <h2>LEO Prototype</h2>
      <div class="actions">
        <button class="btn secondary" on:click={loadData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
        <button class="btn secondary" on:click={handleLogout}>Logout</button>
      </div>
    </div>

    <div class="stats">
      <div>
        <span class="label">Satellites loaded</span>
        <strong>{satelliteCount}</strong>
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
      <div class="error">{error}</div>
    {/if}
  </div>

  <div class="controls glass fade-in">
    <div class="control">
      <div class="control-header">
        <span>Satellites to view</span>
        <strong>{Math.min(displayCount, satelliteCount)}</strong>
      </div>
      <input
        class="range"
        type="range"
        min="1"
        max={Math.max(1, satelliteCount)}
        step="1"
        bind:value={displayCount}
      />
    </div>

    <div class="control">
      <div class="control-header">
        <span>Trajectory hours</span>
        <strong>{trajectoryHours}h</strong>
      </div>
      <input
        class="range"
        type="range"
        min="1"
        max="480"
        step="1"
        bind:value={trajectoryHours}
      />
    </div>
  </div>
</div>

<style>
  .space_view {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  #cesiumContainer {
    position: absolute;
    inset: 0;
  }

  .overlay {
    position: absolute;
    top: 24px;
    left: 24px;
    padding: 20px;
    border-radius: 16px;
    width: min(420px, 90vw);
    display: grid;
    gap: 16px;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .overlay-header h2 {
    margin: 0;
    font-size: 18px;
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .stats {
    display: grid;
    gap: 12px;
  }

  .stats div {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
  }

  .label {
    color: var(--muted);
  }

  .error {
    color: #ff8797;
    font-size: 13px;
  }

  .controls {
    position: absolute;
    bottom: 24px;
    left: 24px;
    padding: 16px;
    border-radius: 16px;
    width: min(320px, 88vw);
    display: grid;
    gap: 16px;
  }

  .control {
    display: grid;
    gap: 8px;
    font-size: 14px;
  }

  .control-header {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
  }

  .range {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
