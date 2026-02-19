<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { isAuthenticated } from '$lib/auth';
  import * as Cesium from 'cesium';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;

  // Unified satellite list
  let satellites = [
    { name: "Hubble Space Telescope", status: "operational" },
    { name: "GPS IIF-3", status: "operational" },
    { name: "NOAA-20", status: "warning", issue: "Telemetry delay" },
    { name: "SatCom-12", status: "critical", issue: "Low battery" },
    { name: "WeatherSat-X", status: "critical", issue: "Signal loss" }
  ];

  // Split into two columns:
  $: healthySatellites = satellites.filter(s => s.status === "operational");
  $: problemSatellites = satellites.filter(s => s.status !== "operational");

  function goToSpaceView() {
    goto('/space_view');
  }

  onMount(async () => {
    if (!isAuthenticated()) {
      goto('/login');
      return;
    }

    if (!browser) return;

    // Create mini Cesium globe
    viewer = new Cesium.Viewer("miniGlobe", {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false
    });

    viewer.scene.globe.enableLighting = true;

    // Slow rotation
    viewer.clock.onTick.addEventListener(() => {
      viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.0005);
    });
  });

  onDestroy(() => {
    if (viewer) viewer.destroy();
  });
</script>

<svelte:head>
  <title>Prototype | Dashboard</title>
</svelte:head>

<div class="dashboard">

  <!-- Mini Globe Section -->
  <div class="mini-globe-container" on:click={goToSpaceView}>
    <div id="miniGlobe"></div>
    <div class="globe-label">Click for Space View</div>
  </div>

  <!-- Satellite Status Section -->
  <div class="satellite-columns">

  <!-- Operational -->
  <div class="column healthy">
    <h2>🟢 Operational Satellites</h2>
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
    <h2>⚠ Satellites Requiring Attention</h2>
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

  /* Mini Globe */
  .mini-globe-container {
    height: 250px;
    cursor: pointer;
    position: relative;
    border-bottom: 2px solid #1c2438;
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

  .sat-card {
    padding: 12px;
    margin-bottom: 10px;
    border-radius: 6px;
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
