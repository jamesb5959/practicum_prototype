<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { isAuthenticated, logout } from '$lib/auth';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;
  let error = '';
  let lastUpdated = '';
  let CesiumLib;

  // Unified satellite list
  let satellites = [
    { name: "Hubble Space Telescope", status: "operational" },
    { name: "GPS IIF-3", status: "operational" },
    { name: "NOAA-20", status: "operational" },
    { name: "SatCom-12", status: "warning", issue: "Off Course" },
    { name: "WeatherSat-X", status: "critical", issue: "Collision Detected!" }
  ];

  // Split into two columns:
  $: healthySatellites = satellites.filter(s => s.status === "operational");
  $: problemSatellites = satellites.filter(s => s.status !== "operational");

  onMount(async () => {
    if (!isAuthenticated()) {
      goto('/login');
      return;
    }

    if (!browser) return;

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

      // Disable user interactions
      viewer.scene.screenSpaceCameraController.enableRotate = false;
      viewer.scene.screenSpaceCameraController.enableTranslate = false;
      viewer.scene.screenSpaceCameraController.enableZoom = false;
      viewer.scene.screenSpaceCameraController.enableTilt = false;
      viewer.scene.screenSpaceCameraController.enableLook = false;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.scene.screenSpaceCameraController.enableInputs = false; // disables mouse/keyboard

      // Hide Cesium logo
      viewer.cesiumWidget.creditContainer.style.display = 'none';

      viewer.scene.globe.enableLighting = true;

      viewer.clock.onTick.addEventListener(() => {
        viewer.scene.camera.rotate(CesiumLib.Cartesian3.UNIT_Z, 0.0005);
      });
    } catch (err) {
      error = err instanceof Error ? `Cesium init failed: ${err.message}` : 'Cesium init failed.';
      lastUpdated = new Date().toLocaleString();
    }
  });

  onDestroy(() => {
    if (viewer) viewer.destroy();
  });

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  function handleLogout() {
    logout();
    goto('/login');
  }

  function goToSpaceView() {
    goto('/space_view');
  }
</script>

<svelte:head>
  <title>Prototype | Dashboard</title>
</svelte:head>

<div class="dashboard">
  <div class="dashboard-header">
    <div class="title">LEO Dashboard</div>
    <button class="logout-btn" on:click={handleLogout}>Logout</button>
  </div>

  <!-- Mini Globe Section -->
  <button class="mini-globe-container" on:click={goToSpaceView} aria-label="Go to Space View">
    <div id="miniGlobe"></div>
    <div class="globe-label">Click for Space View</div>
  </button>

  <!-- Satellite Status Section -->
  <div class="satellite-columns">

  <!-- Operational -->
  <div class="column healthy">
    <h2>🟢 Operational Systems</h2>
    {#each healthySatellites as sat}
      <div class="sat-card operational">
        <span class="status-dot operational-dot"></span>
        {sat.name}
        <span class="badge operational-badge">OPERATIONAL</span>
      </div>
    {/each}
  </div>

  <!-- Warning + Critical -->
  <div class="column problem">
    <h2>⚠ Systems Requiring Attention</h2>
    {#each problemSatellites as sat}
      <div class="sat-card {sat.status}">
        <span class="status-dot {sat.status}-dot"></span>

        <div class="sat-info">
          <strong>{sat.name}</strong>
          {#if sat.issue}
            <div class="issue">{sat.issue}</div>
          {/if}
        </div>

        <span class="badge {sat.status}-badge">
          {sat.status.toUpperCase()}
        </span>
      </div>
    {/each}
  </div>

</div>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #0b0f1a;
    color: white;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    background: #0a0d16;
    border-bottom: 2px solid #1c2438;
    color: white;
    font-weight: bold;
  }

  /* Mini Globe */
  .mini-globe-container {
    all: unset;
    display: block;
    height: 250px;
    cursor: pointer;
    position: relative;
    border-bottom: 2px solid #1c2438;
  }

  .logout-btn {
    all: unset;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: 4px;
    background: #ff3b3b;
    color: white;
    font-weight: bold;
    font-size: 14px;
    text-align: center;
  }

  .logout-btn:hover {
    background: #ff5757;
  }

  #miniGlobe {
    height: 100%;
    width: 100%;
  }

  .globe-label {
    position: absolute;
    bottom: 10px;
    right: 20px;
    font-size: 14px;
    opacity: 0.7;
  }

  /* Columns */
  .satellite-columns {
    flex: 1;
    display: flex;
  }

  .column {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
  }

  .column h2 {
    margin-bottom: 15px;
  }

  /* Healthy */
  .healthy {
    background: #0e1c14;
  }

  .healthy-card {
    background: #163d26;
    border-left: 4px solid #00ff88;
  }

  /* Problem */
  .problem {
    background: #1a0f14;
  }

  .problem-card {
    background: #3d1620;
    border-left: 4px solid #ff3b3b;
  }

  .issue {
    font-size: 12px;
    opacity: 0.8;
  }

  /* Status Dot */
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 10px;
  }

  /* Dot Colors */
  .operational-dot { background: #00ff88; }
  .warning-dot { background: #ffcc00; }
  .critical-dot { background: #ff3b3b; }

  /* Badge */
  .badge {
    margin-left: auto;
    padding: 4px 8px;
    font-size: 11px;
    border-radius: 4px;
    font-weight: bold;
  }

  .operational-badge {
    background: #163d26;
    color: #00ff88;
  }

  .warning-badge {
    background: #3d3300;
    color: #ffcc00;
  }

  .critical-badge {
    background: #3d1620;
    color: #ff3b3b;
  }

  /* Card Layout */
  .sat-card {
    display: flex;
    align-items: center;
    padding: 12px;
    margin-bottom: 10px;
    border-radius: 6px;
    background: #111827;
  }

  .sat-info {
    display: flex;
    flex-direction: column;
  }

  .issue {
    font-size: 12px;
    opacity: 0.8;
  }

  /* Optional glow for critical */
  .critical {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { box-shadow: 0 0 0px #ff3b3b; }
    50% { box-shadow: 0 0 15px #ff3b3b; }
    100% { box-shadow: 0 0 0px #ff3b3b; }
  }
</style>
