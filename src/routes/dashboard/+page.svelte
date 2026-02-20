<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { isAuthenticated, logout } from '$lib/auth';
  import { fetchActiveAndDebrisTle, parseTle, propagateToGeodetic } from '$lib/tle';
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
  let renderedSatelliteCount = 0;
  let trajectoryHours = 24;
  let selectedSat = null;
  let infoTab = 'telemetry';
  let selectedAnomalyAnalysis = null;
  let anomalyChatInput = '';
  let anomalyChatMessages = [];
  let anomalyChatSat = '';
  let filtersOpen = false;
  let filterLeo = true;
  let filterMeo = false;
  let filterGeo = false;
  let filterDebris = true;
  let showTrajectoryLines = false;
  let filterUnclassified = true;
  let filterCui = false;
  let filterClassified = false;
  let sensitivePromptOpen = false;
  let sensitivePasswordInput = '';
  let sensitivePasswordError = '';
  let pendingSensitiveFilter = '';
  const SENSITIVE_FILTER_PASSWORD = 'admin';
  const LEO_MAX_KM = 2000;
  const MEO_MAX_KM = 35786;
  const MAX_PROTOTYPE_SATELLITES = 2000;
  const SAT_ICON_BLUE = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<rect x="13" y="10" width="6" height="12" rx="2" fill="#4dd7ff"/>' +
      '<rect x="6" y="12" width="6" height="8" rx="1" fill="#7fe3ff"/>' +
      '<rect x="20" y="12" width="6" height="8" rx="1" fill="#7fe3ff"/>' +
      '<circle cx="16" cy="16" r="2" fill="#0b1020"/>' +
    '</svg>'
  );
  const SAT_ICON_RED = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<rect x="13" y="10" width="6" height="12" rx="2" fill="#ff5a6b"/>' +
      '<rect x="6" y="12" width="6" height="8" rx="1" fill="#ff8797"/>' +
      '<rect x="20" y="12" width="6" height="8" rx="1" fill="#ff8797"/>' +
      '<circle cx="16" cy="16" r="2" fill="#0b1020"/>' +
    '</svg>'
  );
  const SAT_ICON_DEBRIS = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<path d="M16 4 L24 7 L28 14 L25 23 L17 28 L9 25 L4 17 L7 8 Z" fill="#facc15"/>' +
      '<path d="M11 12 L21 20 M20 11 L12 21" stroke="#0b1020" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="6.5" cy="6.5" r="1.5" fill="#fde047"/>' +
      '<circle cx="26" cy="9" r="1.2" fill="#fde047"/>' +
      '<circle cx="24.5" cy="25" r="1.3" fill="#fde047"/>' +
    '</svg>'
  );
  const WARN_ICON = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<path d="M16 4 L29 28 H3 Z" fill="#ffb84d"/>' +
      '<rect x="15" y="11" width="2" height="9" fill="#1f1400"/>' +
      '<rect x="15" y="22.5" width="2" height="2" fill="#1f1400"/>' +
    '</svg>'
  );

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
      viewer = new CesiumLib.Viewer('cesiumContainer', {
        baseLayer: CesiumLib.ImageryLayer.fromProviderAsync(
          CesiumLib.SingleTileImageryProvider.fromUrl('/textures/earth.jpg', {
            rectangle: CesiumLib.Rectangle.MAX_VALUE,
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
    viewer.scene.globe.show = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 120000;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;
    viewer.scene.backgroundColor = CesiumLib.Color.BLACK;
    viewer.cesiumWidget.creditContainer.style.display = 'none';

    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity) {
        selectedSat = null;
        infoTab = 'telemetry';
        return;
      }
      const match = tracked.find((item) => item.entity === entity);
      selectedSat = match ? match.meta : null;
      infoTab = 'telemetry';
    });

    await loadData();

    refreshTimer = setInterval(loadData, 10 * 60 * 1000);
    positionTimer = setInterval(updatePositions, 5000);
  });

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  function svgData(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
      const { activeText, debrisText, source } = await fetchActiveAndDebrisTle();
      const activeSats = parseTle(activeText).map((sat) => ({ ...sat, isDebris: false }));
      const debrisSats = parseTle(debrisText).map((sat) => ({ ...sat, isDebris: true }));
      dataSource = source;
      lastUpdated = new Date().toLocaleString();
      allSatellites = [...activeSats, ...debrisSats];
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
      const shifted = applyGeoOffset(geo, item.latOffset || 0, item.lonOffset || 0);
      item.entity.position = CesiumLib.Cartesian3.fromDegrees(
        shifted.lon,
        shifted.lat,
        shifted.altKm * 1000
      );
      if (item.warnEntity) {
        item.warnEntity.position = item.entity.position;
      }
      if (item.trajectory && showTrajectoryLines) {
        item.trajectory.polyline.positions = buildTrajectoryWithOffset(
          item.satrec,
          trajectoryHours,
          item.latOffset || 0,
          item.lonOffset || 0
        );
      }
      if (selectedSat && item.meta && selectedSat.name === item.meta.name) {
        selectedSat = {
          ...selectedSat,
          lat: shifted.lat.toFixed(3),
          lon: shifted.lon.toFixed(3),
          altKm: shifted.altKm.toFixed(1)
        };
      }
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

  function clampLat(lat) {
    return Math.max(-85, Math.min(85, lat));
  }

  function normalizeLon(lon) {
    let value = lon;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  }

  function applyGeoOffset(geo, latOffset, lonOffset) {
    return {
      lat: clampLat(geo.lat + latOffset),
      lon: normalizeLon(geo.lon + lonOffset),
      altKm: geo.altKm
    };
  }

  function buildTrajectoryWithOffset(satrec, hours, latOffset, lonOffset) {
    const positions = [];
    const now = Date.now();
    const totalMs = hours * 60 * 60 * 1000;
    const steps = Math.min(160, Math.max(16, Math.floor(hours / 3)));
    for (let i = 0; i <= steps; i += 1) {
      const time = new Date(now + (totalMs * i) / steps);
      const geo = propagateToGeodetic(satrec, time);
      if (!geo) continue;
      const shifted = applyGeoOffset(geo, latOffset, lonOffset);
      positions.push(
        CesiumLib.Cartesian3.fromDegrees(shifted.lon, shifted.lat, shifted.altKm * 1000)
      );
    }
    return positions;
  }

  function seededUnit(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function buildRandomCloneOffsets(name, cloneId) {
    const seed = hashString(`${name}-${cloneId}`);
    return {
      latOffset: seededUnit(seed) * 140 - 70,
      lonOffset: seededUnit(seed * 1.37 + 17) * 360 - 180
    };
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function buildAnomalyAnalysis(meta) {
    const seed = hashString(meta.name);
    const causeOptions = [
      'attitude control drift signature',
      'reaction wheel torque imbalance',
      'thermal expansion affecting panel alignment',
      'minor orbit determination residual growth'
    ];
    const actionOptions = [
      'adjust +2.0° north',
      'adjust +1.8° north-east',
      'adjust +2.2° north-west',
      'apply +2.0° north with 0.4° east trim'
    ];
    const cause = causeOptions[seed % causeOptions.length];
    const action = actionOptions[(seed >>> 2) % actionOptions.length];
    const resolutionHours = 240 + (seed % 121); // 10-15 days in hours

    return {
      cause,
      resolutionHours,
      action,
      confidence: 82 + (seed % 14)
    };
  }

  function buildFakeAnomalyReply(userText) {
    if (!selectedAnomalyAnalysis) return 'No anomaly model context is active.';
    const seed = hashString(userText.toLowerCase());
    const variants = [
      `Telemetry trend suggests we keep monitoring for the next ${selectedAnomalyAnalysis.resolutionHours} hours.`,
      `Best visual recommendation remains: ${selectedAnomalyAnalysis.action}.`,
      `Primary signal still points to ${selectedAnomalyAnalysis.cause}.`,
      `No escalation needed yet. Re-check guidance after one orbital cycle.`
    ];
    return variants[seed % variants.length];
  }

  function submitAnomalyChat() {
    const text = anomalyChatInput.trim();
    if (!text) return;
    anomalyChatMessages = [
      ...anomalyChatMessages,
      { role: 'user', text },
      { role: 'assistant', text: buildFakeAnomalyReply(text) }
    ];
    anomalyChatInput = '';
  }

  function getOrbitBand(altKm) {
    if (altKm <= LEO_MAX_KM) return 'LEO';
    if (altKm <= MEO_MAX_KM) return 'MEO';
    return 'GEO';
  }

  function isOrbitEnabled(altKm) {
    const band = getOrbitBand(altKm);
    return (band === 'LEO' && filterLeo) || (band === 'MEO' && filterMeo) || (band === 'GEO' && filterGeo);
  }

  function rebuildEntities() {
    if (!viewer || !CesiumLib) return;
    viewer.entities.removeAll();
    tracked = [];
    const now = new Date();
    const visible = allSatellites
      .map((sat) => {
        const geo = propagateToGeodetic(sat.satrec, now);
        return geo ? { sat, geo } : null;
      })
      .filter((item) => item !== null)
      .filter(({ sat, geo }) => {
        if (sat.isDebris) return filterDebris;
        if (!isOrbitEnabled(geo.altKm)) return false;
        // Current feed has no security classification metadata.
        if (!filterUnclassified) return false;
        return true;
      });
    const satelliteVisible = visible.filter(({ sat }) => !sat.isDebris);
    const debrisVisible = visible.filter(({ sat }) => sat.isDebris);
    satelliteCount = satelliteVisible.length;
    renderedSatelliteCount = satelliteVisible.length
      ? Math.min(Math.max(1, displayCount), MAX_PROTOTYPE_SATELLITES)
      : 0;
    const selectedSatellites = [];
    for (let i = 0; i < renderedSatelliteCount; i += 1) {
      const base = satelliteVisible[i % satelliteVisible.length];
      const cloneRound = Math.floor(i / satelliteVisible.length);
      const cloneId = i + 1;
      const randomOffsets =
        cloneRound > 0 ? buildRandomCloneOffsets(base.sat.name, cloneId) : { latOffset: 0, lonOffset: 0 };
      selectedSatellites.push({
        ...base,
        latOffset: randomOffsets.latOffset,
        lonOffset: randomOffsets.lonOffset,
        cloneId,
        isClone: cloneRound > 0
      });
    }
    const selected = [...selectedSatellites, ...debrisVisible];
    for (let i = 0; i < selected.length; i += 1) {
      const { sat, geo } = selected[i];
      const latOffset = selected[i].latOffset || 0;
      const lonOffset = selected[i].lonOffset || 0;
      const shifted = applyGeoOffset(geo, latOffset, lonOffset);
      const anomaly = !sat.isDebris && sat.name.length % 7 === 0;
      const status = sat.isDebris ? 'DEBRIS' : anomaly ? 'ANOMALY' : 'NORMAL';
      const pressure = (0.0001 + (sat.name.length % 9) * 0.00003).toFixed(6);
      const uptime = `${(sat.name.length % 28) + 1} days`;
      const position = CesiumLib.Cartesian3.fromDegrees(
        shifted.lon,
        shifted.lat,
        shifted.altKm * 1000
      );
      const displayName = sat.isDebris || !selected[i].isClone ? sat.name : `${sat.name} #${selected[i].cloneId}`;
      const entity = viewer.entities.add({
        name: displayName,
        position,
        billboard: {
          image: sat.isDebris ? SAT_ICON_DEBRIS : anomaly ? SAT_ICON_RED : SAT_ICON_BLUE,
          width: 18,
          height: 18
        }
      });
      const warnEntity = anomaly
        ? viewer.entities.add({
            position,
            billboard: {
              image: WARN_ICON,
              width: 14,
              height: 14,
              pixelOffset: new CesiumLib.Cartesian2(0, -18),
              show: new CesiumLib.CallbackProperty(
                () => Math.floor(Date.now() / 500) % 2 === 0,
                false
              )
            }
          })
        : null;
      const trajectory = showTrajectoryLines
        ? viewer.entities.add({
            polyline: {
              positions: buildTrajectoryWithOffset(sat.satrec, trajectoryHours, latOffset, lonOffset),
              width: 1.5,
              material: (
                sat.isDebris
                  ? CesiumLib.Color.LIGHTGRAY
                  : anomaly
                    ? CesiumLib.Color.RED
                    : CesiumLib.Color.CYAN
              ).withAlpha(0.45)
            }
          })
        : null;
      tracked.push({
        satrec: sat.satrec,
        latOffset,
        lonOffset,
        entity,
        trajectory,
        warnEntity,
        meta: {
          name: displayName,
          status,
          pressure,
          uptime,
          anomaly,
          objectType: sat.isDebris ? 'Debris' : 'Satellite',
          orbitBand: getOrbitBand(geo.altKm),
          lat: shifted.lat.toFixed(3),
          lon: shifted.lon.toFixed(3),
          altKm: shifted.altKm.toFixed(1)
        }
      });
    }
    updatePositions();
  }

  function handleLogout() {
    logout();
    goto('/login');
  }

  function requestSensitiveFilter(filterName) {
    pendingSensitiveFilter = filterName;
    sensitivePasswordInput = '';
    sensitivePasswordError = '';
    sensitivePromptOpen = true;
  }

  function handleCuiChange(event) {
    const checked = event.currentTarget.checked;
    if (!checked) {
      filterCui = false;
      return;
    }
    requestSensitiveFilter('cui');
  }

  function handleClassifiedChange(event) {
    const checked = event.currentTarget.checked;
    if (!checked) {
      filterClassified = false;
      return;
    }
    requestSensitiveFilter('classified');
  }

  function closeSensitivePrompt() {
    sensitivePromptOpen = false;
    pendingSensitiveFilter = '';
    sensitivePasswordInput = '';
    sensitivePasswordError = '';
  }

  function submitSensitivePassword() {
    if (sensitivePasswordInput !== SENSITIVE_FILTER_PASSWORD) {
      sensitivePasswordError = 'Incorrect password.';
      return;
    }

    if (pendingSensitiveFilter === 'cui') {
      filterCui = true;
    }
    if (pendingSensitiveFilter === 'classified') {
      filterClassified = true;
    }
    closeSensitivePrompt();
  }

  $: selectedAnomalyAnalysis =
    selectedSat && selectedSat.anomaly ? buildAnomalyAnalysis(selectedSat) : null;

  $: {
    const satName = selectedSat && selectedSat.anomaly ? selectedSat.name : '';
    if (satName !== anomalyChatSat) {
      anomalyChatSat = satName;
      anomalyChatInput = '';
      anomalyChatMessages = satName
        ? [
            {
              role: 'assistant',
              text: 'Anomaly assistant ready. Ask for probable cause, timing, or maneuver guidance.'
            }
          ]
        : [];
    }
  }

  $: if (viewer && CesiumLib) {
    displayCount;
    trajectoryHours;
    filterLeo;
    filterMeo;
    filterGeo;
    filterDebris;
    filterUnclassified;
    filterCui;
    filterClassified;
    showTrajectoryLines;
    rebuildEntities();
  }
</script>

<svelte:head>
  <title>LEO Prototype | Dashboard</title>
</svelte:head>

<div class="dashboard" class:sensitive-blur={sensitivePromptOpen}>
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

    <div class="legend">
      <span class="legend-item"><span class="dot nominal"></span> Normal</span>
      <span class="legend-item"><span class="dot anomaly"></span> Anomaly</span>
      <span class="legend-item"><span class="dot debris"></span> Debris</span>
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
        <strong>{renderedSatelliteCount}</strong>
      </div>
      <input
        class="range"
        type="range"
        min="1"
        max={MAX_PROTOTYPE_SATELLITES}
        step="1"
        bind:value={displayCount}
      />
    </div>

    {#if showTrajectoryLines}
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
    {/if}
  </div>

  <div class:filters-open={filtersOpen} class="filters-shell">
    <button class="filters-toggle glass" on:click={() => (filtersOpen = !filtersOpen)}>
      {filtersOpen ? 'Close' : 'Filters'}
    </button>
    <div class="filters glass">
      <h3>Filter Sets</h3>
      <div class="filter-group">
        <label><input type="checkbox" bind:checked={filterLeo} /> LEO</label>
        <label><input type="checkbox" bind:checked={filterMeo} /> MEO</label>
        <label><input type="checkbox" bind:checked={filterGeo} /> GEO</label>
        <label><input type="checkbox" bind:checked={filterDebris} /> Debris</label>
      </div>
      <div class="filter-group">
        <label><input type="checkbox" bind:checked={filterUnclassified} /> UNCLASSIFIED</label>
        <label><input type="checkbox" checked={filterCui} on:change={handleCuiChange} /> CUI</label>
        <label>
          <input type="checkbox" checked={filterClassified} on:change={handleClassifiedChange} />
          CLASSIFIED
        </label>
        <label><input type="checkbox" bind:checked={showTrajectoryLines} /> Trajectory lines</label>
      </div>
    </div>
  </div>

  {#if selectedSat}
    <div class="info glass fade-in">
      <h3>{selectedSat.name}</h3>
      <div class="tabs">
        <button class:active={infoTab === 'telemetry'} on:click={() => (infoTab = 'telemetry')}>
          Telemetry
        </button>
        <button class:active={infoTab === 'orbit'} on:click={() => (infoTab = 'orbit')}>Orbit</button>
        <button class:active={infoTab === 'risk'} on:click={() => (infoTab = 'risk')}>Risk</button>
      </div>

      {#if infoTab === 'telemetry'}
        <div class="info-grid">
          <div>
            <span class="label">Status</span>
            <strong class:warn={selectedSat.anomaly}>{selectedSat.status}</strong>
          </div>
          <div><span class="label">Object</span><strong>{selectedSat.objectType}</strong></div>
          <div><span class="label">Pressure</span><strong>{selectedSat.pressure}</strong></div>
          <div><span class="label">Uptime</span><strong>{selectedSat.uptime}</strong></div>
        </div>
      {/if}

      {#if infoTab === 'orbit'}
        <div class="info-grid">
          <div><span class="label">Orbit band</span><strong>{selectedSat.orbitBand}</strong></div>
          <div><span class="label">Latitude</span><strong>{selectedSat.lat || '—'}</strong></div>
          <div><span class="label">Longitude</span><strong>{selectedSat.lon || '—'}</strong></div>
          <div><span class="label">Altitude</span><strong>{selectedSat.altKm || '—'} km</strong></div>
        </div>
      {/if}

      {#if infoTab === 'risk'}
        <div class="info-grid">
          <div><span class="label">Risk level</span><strong>{selectedSat.anomaly ? 'Elevated' : 'Low'}</strong></div>
          <div><span class="label">Proximity risk</span><strong>{selectedSat.anomaly ? 'Monitor' : 'Nominal'}</strong></div>
          <div><span class="label">Recommended action</span><strong>{selectedSat.anomaly ? 'Plan correction burn' : 'None'}</strong></div>
        </div>
      {/if}

    </div>
  {/if}

  {#if selectedAnomalyAnalysis}
    <div class="anomaly-llm glass fade-in">
      <h3>Anomaly Assistant</h3>
      <p>
        Preliminary model readout indicates <strong>{selectedAnomalyAnalysis.cause}</strong>.
      </p>
      <p>
        Predicted correction window: <strong>{selectedAnomalyAnalysis.resolutionHours} hours</strong>.
      </p>
      <p>
        Suggested maneuver: <strong>{selectedAnomalyAnalysis.action}</strong>.
      </p>
      <p class="confidence">Model confidence: {selectedAnomalyAnalysis.confidence}%</p>
      <div class="chat-log">
        {#each anomalyChatMessages as message}
          <div class="chat-msg" class:user={message.role === 'user'}>
            <span class="chat-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
            <span>{message.text}</span>
          </div>
        {/each}
      </div>
      <form class="chat-form" on:submit|preventDefault={submitAnomalyChat}>
        <input
          class="chat-input"
          type="text"
          placeholder="Ask anomaly assistant..."
          bind:value={anomalyChatInput}
        />
      </form>
    </div>
  {/if}

  {#if sensitivePromptOpen}
    <div class="sensitive-backdrop">
      <form class="sensitive-modal glass" on:submit|preventDefault={submitSensitivePassword}>
        <h3>Restricted Filter Access</h3>
        <p>Enter password to enable {pendingSensitiveFilter === 'cui' ? 'CUI' : 'CLASSIFIED'}.</p>
        <input
          type="password"
          class="sensitive-input"
          placeholder="Password"
          bind:value={sensitivePasswordInput}
        />
        {#if sensitivePasswordError}
          <div class="sensitive-error">{sensitivePasswordError}</div>
        {/if}
        <div class="sensitive-actions">
          <button type="button" class="btn secondary" on:click={closeSensitivePrompt}>Cancel</button>
          <button type="submit" class="btn secondary">Continue</button>
        </div>
      </form>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .dashboard.sensitive-blur > :not(.sensitive-backdrop) {
    filter: blur(4px);
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

  .legend {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--muted);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    display: inline-block;
  }

  .dot.nominal {
    background: #4dd7ff;
  }

  .dot.anomaly {
    background: #ff5a6b;
  }

  .dot.debris {
    background: #facc15;
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

  .info {
    position: absolute;
    top: 24px;
    right: 24px;
    padding: 16px;
    border-radius: 16px;
    width: min(320px, 88vw);
    display: grid;
    gap: 12px;
  }

  .anomaly-llm {
    position: absolute;
    right: 24px;
    bottom: 24px;
    width: min(340px, 88vw);
    padding: 14px;
    border-radius: 16px;
    display: grid;
    gap: 8px;
    z-index: 4;
  }

  .anomaly-llm h3 {
    margin: 0;
    font-size: 15px;
  }

  .anomaly-llm p {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.45;
  }

  .anomaly-llm strong {
    color: var(--fg);
  }

  .confidence {
    color: #ffb84d;
  }

  .chat-log {
    max-height: 140px;
    overflow: auto;
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding-right: 2px;
  }

  .chat-msg {
    font-size: 12px;
    display: grid;
    gap: 2px;
    color: var(--muted);
  }

  .chat-msg.user {
    color: #d2e9ff;
  }

  .chat-role {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.8;
  }

  .chat-form {
    margin-top: 4px;
  }

  .chat-input {
    width: 100%;
    border: 1px solid var(--border);
    background: rgba(15, 23, 42, 0.65);
    color: var(--fg);
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 12px;
    outline: none;
  }

  .chat-input:focus {
    border-color: #60a5fa;
  }

  .sensitive-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(2, 6, 23, 0.45);
    display: grid;
    place-items: center;
    z-index: 20;
  }

  .sensitive-modal {
    width: min(360px, 92vw);
    padding: 16px;
    border-radius: 14px;
    display: grid;
    gap: 10px;
  }

  .sensitive-modal h3 {
    margin: 0;
    font-size: 16px;
  }

  .sensitive-modal p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  .sensitive-input {
    border: 1px solid var(--border);
    background: rgba(15, 23, 42, 0.65);
    color: var(--fg);
    border-radius: 10px;
    padding: 9px 10px;
    font-size: 13px;
    outline: none;
  }

  .sensitive-input:focus {
    border-color: #60a5fa;
  }

  .sensitive-error {
    color: #ff8797;
    font-size: 12px;
  }

  .sensitive-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .filters-shell {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 3;
  }

  .filters-toggle {
    border: 1px solid var(--border);
    border-radius: 0 12px 12px 0;
    padding: 12px 14px;
    background: rgba(15, 23, 42, 0.75);
    color: var(--fg);
    cursor: pointer;
    font-weight: 600;
  }

  .filters {
    width: 240px;
    padding: 16px;
    border-radius: 12px;
    transform: translateX(-260px);
    transition: transform 200ms ease;
  }

  .filters-open .filters {
    transform: translateX(0);
  }

  .filters h3 {
    margin: 0 0 10px 0;
    font-size: 14px;
  }

  .filter-group {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
    font-size: 13px;
    color: var(--muted);
  }

  .filter-group label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .info h3 {
    margin: 0;
    font-size: 16px;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .tabs button {
    border: 1px solid var(--border);
    background: rgba(15, 23, 42, 0.5);
    color: var(--muted);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .tabs button.active {
    color: var(--fg);
    border-color: #60a5fa;
    background: rgba(37, 99, 235, 0.2);
  }

  .info-grid {
    display: grid;
    gap: 10px;
    font-size: 13px;
  }

  .info-grid div {
    display: flex;
    justify-content: space-between;
  }

  .warn {
    color: #ff8797;
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
