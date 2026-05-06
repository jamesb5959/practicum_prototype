<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { fetchActiveAndDebrisTle, parseTle, propagateToGeodetic } from '$lib/tle';
  import {
    activeConjunctions,
    collisionConfig,
    initCollisionConfig,
    refreshConjunctions,
    updateCollisionConfig
  } from '$lib/conjunction';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;
  let CesiumLib;
  let error = '';
  let loading = true;
  let lastUpdated = '';
  let dataSource = 'Warpcore (Data)';

  let activeCount = 0;
  let debrisCount = 0;
  let operational = [];
  let attention = [];
  let collisionMenuOpen = false;
  let selectedHorizon = '24';
  let selectedThreshold = '10';

  let detailsOpen = false;
  let detailsItem = null;
  let detailsRelatedConjunctions = [];
  let detailsTab = 'summary';
  let activeDetailsKey = '';
  let detailsPlacement = null;

  let detailsEnrichedFields = null;
  let detailsEnrichedLoading = false;
  let detailsEnrichedError = '';

  let detailsPrimaryEnrichedFields = null;
  let detailsPrimaryEnrichedLoading = false;
  let detailsPrimaryEnrichedError = '';

  let detailsSecondaryEnrichedFields = null;
  let detailsSecondaryEnrichedLoading = false;
  let detailsSecondaryEnrichedError = '';

  let detailsRequestId = 0;

  let summaryRequestId = 0;
  const enrichedNameCache = new Map();

  function normalizeSatelliteNumber(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    const normalized = trimmed.replace(/^0+/, '');
    return normalized || trimmed;
  }

  function formatSatelliteNumber(value) {
    return normalizeSatelliteNumber(value);
  }

  function normalizeEnrichedLabel(label) {
    return String(label ?? '').trim().toLowerCase();
  }

  function getEnrichedSatelliteNameFromFields(fields) {
    if (!Array.isArray(fields)) return null;
    const match = fields.find((field) => normalizeEnrichedLabel(field?.label) === 'satellite name');
    const value = String(match?.value ?? '').trim();
    return value || null;
  }

  function fallbackSatelliteName(satelliteNumber, tleName) {
    const satNum = formatSatelliteNumber(satelliteNumber);
    const raw = String(tleName ?? '').replace(/^0\s+/, '').trim();

    if (raw) {
      const withoutNoradAndNum = satNum
        ? raw.replace(new RegExp(`^NORAD\\s+0*${satNum}\\s*\\|\\s*`, 'i'), '')
        : raw.replace(/^NORAD\s+\d+\s*\|\s*/i, '');
      const withoutNorad = withoutNoradAndNum.replace(/^NORAD\s+/i, '').trim();
      if (withoutNorad) return withoutNorad;
    }

    return satNum ? `Satellite ${satNum}` : 'Satellite';
  }

  function formatLatLon(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return 'Lat —°, Lon —°';
    }
    return `Lat ${Number(lat).toFixed(2)}°, Lon ${Number(lon).toFixed(2)}°`;
  }

  async function getEnrichedSatelliteName(satelliteNumber) {
    const key = normalizeSatelliteNumber(satelliteNumber);
    if (!key) return null;
    if (enrichedNameCache.has(key)) return enrichedNameCache.get(key);

    try {
      const fields = await fetchEnrichedFields(
        `/api/enriched?satelliteNumber=${encodeURIComponent(key)}`
      );
      const name = getEnrichedSatelliteNameFromFields(fields);
      enrichedNameCache.set(key, name);
      return name;
    } catch {
      return null;
    }
  }

  onMount(async () => {
    if (!browser) return;
    initCollisionConfig();

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
    const requestId = (summaryRequestId += 1);

    try {
      const { activeText, debrisText, source } = await fetchActiveAndDebrisTle();
      if (requestId !== summaryRequestId) return;
      const activeSats = parseTle(activeText);
      const debrisSats = parseTle(debrisText);
      const conjunctions = await refreshConjunctions(activeSats);
      if (requestId !== summaryRequestId) return;

      activeCount = activeSats.length;
      debrisCount = debrisSats.length;
      dataSource = source;
      lastUpdated = new Date().toLocaleString();

      const operationalBase = activeSats.slice(0, 6).map((sat) => {
        const geo = propagateToGeodetic(sat.satrec, new Date());
        const altKm = geo ? Math.round(geo.altKm) : null;
        const orbitBand =
          altKm == null
            ? '—'
            : altKm <= 2000
              ? 'LEO'
              : altKm <= 35786
                ? 'MEO'
                : 'GEO';

        return {
          kind: 'satellite',
          context: 'operational',
          name: fallbackSatelliteName(sat.fields?.satelliteNumber, sat.name),
          satelliteNumber: sat.fields?.satelliteNumber,
          status: 'tracked',
          orbitBand,
          altKm
        };
      });

      const orbitCounts = activeSats.reduce(
        (acc, sat) => {
          const geo = propagateToGeodetic(sat.satrec, new Date());
          if (!geo) return acc;
          if (geo.altKm <= 2000) acc.leo += 1;
          else if (geo.altKm <= 35786) acc.meo += 1;
          else acc.geo += 1;
          return acc;
        },
        { leo: 0, meo: 0, geo: 0 }
      );

      const attentionBase = [
        ...conjunctions.slice(0, 4).map((event) => ({
          kind: 'conjunction',
          name: `#${formatSatelliteNumber(event.primarySatelliteNumber)} / #${formatSatelliteNumber(event.secondarySatelliteNumber)}`,
          status: 'critical',
          issue: `#${formatSatelliteNumber(event.primarySatelliteNumber)} / #${formatSatelliteNumber(event.secondarySatelliteNumber)} • ${event.distanceKm.toFixed(2)} km @ ${new Date(event.timeIso).toLocaleString()} • ${formatLatLon(event.markerLat, event.markerLon)}`,
          primarySatelliteNumber: event.primarySatelliteNumber,
          secondarySatelliteNumber: event.secondarySatelliteNumber,
          primaryName: fallbackSatelliteName(event.primarySatelliteNumber, event.primaryName),
          secondaryName: fallbackSatelliteName(event.secondarySatelliteNumber, event.secondaryName),
          distanceKm: event.distanceKm,
          timeIso: event.timeIso,
          markerLat: event.markerLat,
          markerLon: event.markerLon,
          markerAltKm: event.markerAltKm
        })),
        {
          kind: 'stat',
          name: 'LEO Objects',
          status: 'tracked',
          issue: `${orbitCounts.leo} tracked in LEO`
        },
        {
          kind: 'stat',
          name: 'MEO Objects',
          status: 'tracked',
          issue: `${orbitCounts.meo} tracked in MEO`
        },
        {
          kind: 'stat',
          name: 'GEO Objects',
          status: 'tracked',
          issue: `${orbitCounts.geo} tracked in GEO`
        },
        {
          kind: 'stat',
          name: 'Loaded Set',
          status: 'tracked',
          issue: `${activeCount} Warpcore objects available`
        }
      ];

      const [operationalEnriched, attentionEnriched] = await Promise.all([
        Promise.all(
          operationalBase.map(async (item) => {
            const enrichedName = await getEnrichedSatelliteName(item.satelliteNumber);
            return {
              ...item,
              name: enrichedName || item.name
            };
          })
        ),
        Promise.all(
          attentionBase.map(async (item) => {
            if (item?.kind !== 'conjunction') return item;

            const [primaryName, secondaryName] = await Promise.all([
              getEnrichedSatelliteName(item.primarySatelliteNumber),
              getEnrichedSatelliteName(item.secondarySatelliteNumber)
            ]);

            const primaryDisplay =
              primaryName || item.primaryName || `#${formatSatelliteNumber(item.primarySatelliteNumber)}`;
            const secondaryDisplay =
              secondaryName || item.secondaryName || `#${formatSatelliteNumber(item.secondarySatelliteNumber)}`;

            return {
              ...item,
              name: `${primaryDisplay} / ${secondaryDisplay}`,
              primaryName: primaryDisplay,
              secondaryName: secondaryDisplay,
              issue: `#${formatSatelliteNumber(item.primarySatelliteNumber)} / #${formatSatelliteNumber(item.secondarySatelliteNumber)} • ${item.distanceKm.toFixed(2)} km @ ${new Date(item.timeIso).toLocaleString()} • ${formatLatLon(item.markerLat, item.markerLon)}`
            };
          })
        )
      ]);

      if (requestId !== summaryRequestId) return;
      operational = operationalEnriched;
      attention = attentionEnriched;
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

  async function handleHorizonChange(event) {
    selectedHorizon = event.currentTarget.value;
    updateCollisionConfig({ horizonHours: Number(selectedHorizon) });
    await loadSummary();
  }

  async function handleThresholdChange(event) {
    selectedThreshold = event.currentTarget.value;
    updateCollisionConfig({ thresholdKm: Number(selectedThreshold) });
    await loadSummary();
  }

  function handleCollisionBackdropKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      collisionMenuOpen = false;
    }
  }

  function closeDetails() {
    detailsOpen = false;
    detailsItem = null;
    activeDetailsKey = '';
    detailsPlacement = null;
    detailsTab = 'summary';
    detailsEnrichedFields = null;
    detailsEnrichedError = '';
    detailsEnrichedLoading = false;
    detailsPrimaryEnrichedFields = null;
    detailsPrimaryEnrichedError = '';
    detailsPrimaryEnrichedLoading = false;
    detailsSecondaryEnrichedFields = null;
    detailsSecondaryEnrichedError = '';
    detailsSecondaryEnrichedLoading = false;
  }

  function getDetailsKey(item) {
    if (!item) return '';
    if (item.kind === 'satellite') {
      return `sat:${normalizeSatelliteNumber(item.satelliteNumber)}`;
    }
    if (item.kind === 'conjunction') {
      return `conj:${normalizeSatelliteNumber(item.primarySatelliteNumber)}:${normalizeSatelliteNumber(item.secondarySatelliteNumber)}:${item.timeIso}`;
    }
    return `${item.kind || 'item'}:${item.name || ''}:${item.issue || ''}`;
  }

  function handleCardKeydown(event, item, column, index) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openDetails(item, column, index);
    }
  }

  function isDetailsItem(column, index) {
    return Boolean(
      detailsOpen &&
        detailsPlacement &&
        detailsPlacement.column === column &&
        detailsPlacement.index === index
    );
  }

  async function fetchEnrichedFields(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Enriched data error: ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data?.fields) ? data.fields : [];
  }

  async function openDetails(item, column, index) {
    if (!browser) return;
    const nextKey = getDetailsKey(item);
    if (
      detailsOpen &&
      activeDetailsKey === nextKey &&
      detailsPlacement?.column === column &&
      detailsPlacement?.index === index
    ) {
      closeDetails();
      return;
    }
    if (detailsOpen) {
      closeDetails();
      await tick();
    }
    collisionMenuOpen = false;
    detailsItem = item;
    activeDetailsKey = nextKey;
    detailsPlacement = { column, index };
    detailsOpen = true;
    detailsTab = 'summary';

    detailsEnrichedFields = null;
    detailsEnrichedError = '';
    detailsEnrichedLoading = false;

    detailsPrimaryEnrichedFields = null;
    detailsPrimaryEnrichedError = '';
    detailsPrimaryEnrichedLoading = false;

    detailsSecondaryEnrichedFields = null;
    detailsSecondaryEnrichedError = '';
    detailsSecondaryEnrichedLoading = false;

    const requestId = (detailsRequestId += 1);

    try {
      if (item?.kind === 'satellite') {
        const satNum = item.satelliteNumber;
        if (!satNum) return;
        detailsEnrichedLoading = true;
        const fields = await fetchEnrichedFields(
          `/api/enriched?satelliteNumber=${encodeURIComponent(satNum)}`
        );
        if (requestId !== detailsRequestId) return;
        detailsEnrichedFields = fields;

        const enrichedName = getEnrichedSatelliteNameFromFields(fields);
        const cacheKey = normalizeSatelliteNumber(satNum);
        if (cacheKey) enrichedNameCache.set(cacheKey, enrichedName);
        if (enrichedName) {
          detailsItem = { ...detailsItem, name: enrichedName };
        }
      }

      if (item?.kind === 'conjunction') {
        const primaryNum = item.primarySatelliteNumber;
        const secondaryNum = item.secondarySatelliteNumber;
        detailsPrimaryEnrichedLoading = Boolean(primaryNum);
        detailsSecondaryEnrichedLoading = Boolean(secondaryNum);

        await Promise.all([
          (async () => {
            if (!primaryNum) return;
            try {
              const fields = await fetchEnrichedFields(
                `/api/enriched?satelliteNumber=${encodeURIComponent(primaryNum)}`
              );
              if (requestId !== detailsRequestId) return;
              detailsPrimaryEnrichedFields = fields;

              const enrichedName = getEnrichedSatelliteNameFromFields(fields);
              const cacheKey = normalizeSatelliteNumber(primaryNum);
              if (cacheKey) enrichedNameCache.set(cacheKey, enrichedName);
              if (enrichedName) {
                detailsItem = { ...detailsItem, primaryName: enrichedName };
              }
            } catch (err) {
              if (requestId !== detailsRequestId) return;
              detailsPrimaryEnrichedError = err instanceof Error ? err.message : 'Failed to load enriched data';
            } finally {
              if (requestId === detailsRequestId) detailsPrimaryEnrichedLoading = false;
            }
          })(),
          (async () => {
            if (!secondaryNum) return;
            try {
              const fields = await fetchEnrichedFields(
                `/api/enriched?satelliteNumber=${encodeURIComponent(secondaryNum)}`
              );
              if (requestId !== detailsRequestId) return;
              detailsSecondaryEnrichedFields = fields;

              const enrichedName = getEnrichedSatelliteNameFromFields(fields);
              const cacheKey = normalizeSatelliteNumber(secondaryNum);
              if (cacheKey) enrichedNameCache.set(cacheKey, enrichedName);
              if (enrichedName) {
                detailsItem = { ...detailsItem, secondaryName: enrichedName };
              }
            } catch (err) {
              if (requestId !== detailsRequestId) return;
              detailsSecondaryEnrichedError = err instanceof Error ? err.message : 'Failed to load enriched data';
            } finally {
              if (requestId === detailsRequestId) detailsSecondaryEnrichedLoading = false;
            }
          })()
        ]);
      }
    } catch (err) {
      if (requestId !== detailsRequestId) return;
      detailsEnrichedError = err instanceof Error ? err.message : 'Failed to load enriched data';
    } finally {
      if (requestId === detailsRequestId) {
        detailsEnrichedLoading = false;
      }
    }
  }

  $: selectedHorizon = String($collisionConfig.horizonHours);
  $: selectedThreshold = String($collisionConfig.thresholdKm);

  $: detailsRelatedConjunctions =
    detailsItem?.kind === 'satellite' && detailsItem?.satelliteNumber
      ? $activeConjunctions
          .filter(
            (event) =>
              event.primarySatelliteNumber === detailsItem.satelliteNumber ||
              event.secondarySatelliteNumber === detailsItem.satelliteNumber
          )
          .slice(0, 6)
      : [];
</script>

<svelte:head>
  <title>Real-Time Conjunction Analyzer | Dashboard</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header glass fade-in">
    <div class="header-copy">
      <span class="eyebrow">Operations Summary</span>
      <h1>Real-Time Conjunction Analyzer</h1>
      <p>Mission snapshot and health overview</p>
    </div>
    <div class="header-actions-group">
      <div class="header-logos" aria-label="Partner logos">
        <img src="/logos/UTEP_Classic_Logo.svg" alt="UTEP logo" class="header-logo utep-logo" />
        <img src="/logos/space-force.png" alt="United States Space Force logo" class="header-logo space-force-logo" />
      </div>
      <div class="header-actions">
        <button class="btn secondary" on:click={loadSummary} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button class="btn secondary" on:click={() => (collisionMenuOpen = true)}>
          Configure
        </button>
        <button class="btn danger" on:click={handleLogout}>Logout</button>
      </div>
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
      <div class="card-header">
        <span class="eyebrow">Snapshot</span>
        <h2>Live Summary</h2>
      </div>
      <div class="summary-grid">
        <div>
          <span class="label">Active satellites</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span class="label">Tracked set size</span>
          <strong>{activeCount + debrisCount}</strong>
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

    <div class="summary glass fade-in collision-summary">
      <div class="collision-header">
        <div>
          <span class="eyebrow">Monitoring</span>
          <h2>Collision Screen</h2>
          <span class="label">Detected conjunctions: {$activeConjunctions.length}</span>
        </div>
      </div>
    </div>
  </section>

  {#if collisionMenuOpen}
    <div
      class="collision-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close collision settings"
      on:click={() => (collisionMenuOpen = false)}
      on:keydown={handleCollisionBackdropKeydown}
    >
      <div
        class="collision-modal glass"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Collision Screen Settings"
        on:click|stopPropagation
        on:keydown|stopPropagation
      >
        <div class="collision-modal-header">
          <h2>Collision Screen Settings</h2>
          <button class="btn secondary" on:click={() => (collisionMenuOpen = false)}>Close</button>
        </div>
        <div class="collision-menu">
          <label>
            <span class="label">Screening horizon</span>
            <select
              bind:value={selectedHorizon}
              on:change={handleHorizonChange}
            >
              <option value="6">6 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
            </select>
          </label>
          <label>
            <span class="label">Alert threshold</span>
            <select
              bind:value={selectedThreshold}
              on:change={handleThresholdChange}
            >
              <option value="5">5 km</option>
              <option value="10">10 km</option>
              <option value="25">25 km</option>
              <option value="50">50 km</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  {/if}

  <section class="satellite-columns fade-in">
    <div class="column glass">
      <div class="section-header">
        <span class="eyebrow">Tracked</span>
        <h3>Operational Systems</h3>
      </div>
      {#if operational.length}
        {#each operational as sat, index}
          <button
            class:selected-card={isDetailsItem('operational', index)}
            class="sat-card"
            aria-haspopup="dialog"
            on:click={() => openDetails(sat, 'operational', index)}
            on:keydown={(event) => handleCardKeydown(event, sat, 'operational', index)}
            type="button"
          >
            <span class="status-dot operational-dot"></span>
            <div class="sat-info">
              <strong class="sat-name">{sat.name}</strong>
              {#if sat.satelliteNumber}
                <span class="issue">#{formatSatelliteNumber(sat.satelliteNumber)}</span>
              {/if}
            </div>
            <span class="badge operational-badge">TRACKED</span>
          </button>
          {#if detailsOpen && isDetailsItem('operational', index)}
            <section class="details-panel details-inline glass fade-in" aria-label="Expanded satellite details">
              <div class="details-panel-header">
                <div class="details-header-copy">
                  <span class="eyebrow">Operational System</span>
                  <h2>{detailsItem.name}</h2>
                  <span class="label">#{formatSatelliteNumber(detailsItem.satelliteNumber)}</span>
                </div>
              </div>

              <div class="details-tabs">
                <button class:active={detailsTab === 'summary'} on:click={() => (detailsTab = 'summary')}>Summary</button>
                <button class:active={detailsTab === 'issues'} on:click={() => (detailsTab = 'issues')}>Issues</button>
                <button class:active={detailsTab === 'missions'} on:click={() => (detailsTab = 'missions')}>Missions</button>
              </div>

              {#if detailsTab === 'summary'}
                <div class="summary-grid details-grid">
                  <div><span class="label">Status</span><strong>{detailsItem.status ? detailsItem.status.toUpperCase() : 'TRACKED'}</strong></div>
                  {#if detailsItem.orbitBand && detailsItem.orbitBand !== '—'}
                    <div><span class="label">Orbit band</span><strong>{detailsItem.orbitBand}</strong></div>
                  {/if}
                  {#if detailsItem.altKm !== null && detailsItem.altKm !== undefined}
                    <div><span class="label">Altitude</span><strong>{detailsItem.altKm} km</strong></div>
                  {/if}
                  <div><span class="label">Screening window</span><strong>{$collisionConfig.horizonHours}h / {$collisionConfig.thresholdKm} km</strong></div>
                </div>
              {:else if detailsTab === 'issues'}
                <div class="details-section">
                  <span class="eyebrow">Detected Conjunctions</span>
                  {#if detailsRelatedConjunctions.length}
                    {#each detailsRelatedConjunctions as event}
                      <div class="details-issue-row">
                        <strong>{event.distanceKm.toFixed(2)} km</strong>
                        <span class="issue">{new Date(event.timeIso).toLocaleString()}</span>
                        <span class="label">#{formatSatelliteNumber(event.primarySatelliteNumber)} / #{formatSatelliteNumber(event.secondarySatelliteNumber)} • {formatLatLon(event.markerLat, event.markerLon)}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="label">No conjunctions detected for this satellite.</div>
                  {/if}
                </div>
              {:else}
                <div class="details-section">
                  <span class="eyebrow">Mission Fields</span>
                  {#if detailsEnrichedLoading}
                    <div class="label">Loading enriched fields...</div>
                  {:else if detailsEnrichedError}
                    <div class="error">{detailsEnrichedError}</div>
                  {:else if detailsEnrichedFields && detailsEnrichedFields.length}
                    <div class="summary-grid details-fields">
                      {#each detailsEnrichedFields as field}
                        <div><span class="label">{field.label}</span><strong>{field.value}</strong></div>
                      {/each}
                    </div>
                  {:else}
                    <div class="label">No enriched fields found for this satellite.</div>
                  {/if}
                </div>
              {/if}
            </section>
          {/if}
        {/each}
      {:else}
        <p class="empty">No active systems available.</p>
      {/if}
    </div>

    <div class="column glass">
      <div class="section-header">
        <span class="eyebrow">Attention</span>
        <h3>Catalog Highlights</h3>
      </div>
      {#if attention.length}
        {#each attention as sat, index}
          <button
            class:selected-card={isDetailsItem('attention', index)}
            class="sat-card"
            aria-haspopup="dialog"
            on:click={() => openDetails(sat, 'attention', index)}
            on:keydown={(event) => handleCardKeydown(event, sat, 'attention', index)}
            type="button"
          >
            <span class="status-dot {sat.status}-dot"></span>
            <div class="sat-info">
              <strong class="sat-name">{sat.name}</strong>
              <span class="issue">{sat.issue}</span>
            </div>
            <span class="badge {sat.status}-badge">{sat.status.toUpperCase()}</span>
          </button>
          {#if detailsOpen && isDetailsItem('attention', index)}
            <section class="details-panel details-inline glass fade-in" aria-label="Expanded attention details">
              <div class="details-panel-header">
                <div class="details-header-copy">
                  <span class="eyebrow">{detailsItem.kind === 'conjunction' ? 'Conjunction Alert' : 'Catalog Highlight'}</span>
                  <h2>
                    {detailsItem.kind === 'conjunction'
                      ? `${detailsItem.primaryName || `#${formatSatelliteNumber(detailsItem.primarySatelliteNumber)}`} / ${detailsItem.secondaryName || `#${formatSatelliteNumber(detailsItem.secondarySatelliteNumber)}`}`
                      : detailsItem.name}
                  </h2>
                </div>
              </div>

              {#if detailsItem.kind === 'conjunction'}
                <div class="details-tabs">
                  <button class:active={detailsTab === 'summary'} on:click={() => (detailsTab = 'summary')}>Summary</button>
                  <button class:active={detailsTab === 'primary'} on:click={() => (detailsTab = 'primary')}>Satellite 1</button>
                  <button class:active={detailsTab === 'secondary'} on:click={() => (detailsTab = 'secondary')}>Satellite 2</button>
                </div>

                {#if detailsTab === 'summary'}
                  <div class="summary-grid details-grid">
                    <div><span class="label">Satellite 1</span><strong>{detailsItem.primaryName}</strong></div>
                    <div><span class="label">Satellite 2</span><strong>{detailsItem.secondaryName}</strong></div>
                    <div><span class="label">Closest approach</span><strong>{detailsItem.distanceKm.toFixed(2)} km</strong></div>
                    <div><span class="label">Expected time</span><strong>{new Date(detailsItem.timeIso).toLocaleString()}</strong></div>
                    <div><span class="label">Location</span><strong>{formatLatLon(detailsItem.markerLat, detailsItem.markerLon)}</strong></div>
                  </div>
                {:else if detailsTab === 'primary'}
                  <div class="details-section">
                    <span class="eyebrow">Satellite 1</span>
                    {#if detailsPrimaryEnrichedLoading}
                      <div class="label">Loading enriched fields...</div>
                    {:else if detailsPrimaryEnrichedError}
                      <div class="error">{detailsPrimaryEnrichedError}</div>
                    {:else if detailsPrimaryEnrichedFields && detailsPrimaryEnrichedFields.length}
                      <div class="summary-grid details-fields">
                        {#each detailsPrimaryEnrichedFields as field}
                          <div><span class="label">{field.label}</span><strong>{field.value}</strong></div>
                        {/each}
                      </div>
                    {:else}
                      <div class="label">No enriched fields found for the primary satellite.</div>
                    {/if}
                  </div>
                {:else}
                  <div class="details-section">
                    <span class="eyebrow">Satellite 2</span>
                    {#if detailsSecondaryEnrichedLoading}
                      <div class="label">Loading enriched fields...</div>
                    {:else if detailsSecondaryEnrichedError}
                      <div class="error">{detailsSecondaryEnrichedError}</div>
                    {:else if detailsSecondaryEnrichedFields && detailsSecondaryEnrichedFields.length}
                      <div class="summary-grid details-fields">
                        {#each detailsSecondaryEnrichedFields as field}
                          <div><span class="label">{field.label}</span><strong>{field.value}</strong></div>
                        {/each}
                      </div>
                    {:else}
                      <div class="label">No enriched fields found for the secondary satellite.</div>
                    {/if}
                  </div>
                {/if}
              {:else}
                <div class="details-tabs">
                  <button class:active={detailsTab === 'summary'} on:click={() => (detailsTab = 'summary')}>Summary</button>
                </div>
                <div class="details-section">
                  <span class="eyebrow">Details</span>
                  <div class="label">{detailsItem.issue || 'No additional details available.'}</div>
                </div>
              {/if}
            </section>
          {/if}
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
    padding: 22px;
    display: grid;
    gap: 18px;
  }

  .dashboard-header {
    border-radius: 16px;
    padding: 18px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 104px;
    animation: panel-rise 220ms ease;
  }

  .header-copy {
    display: grid;
    gap: 4px;
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

  .header-actions-group {
    display: grid;
    justify-items: end;
    gap: 12px;
  }

  .header-logos {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    width: 100%;
  }

  .header-logo {
    display: block;
    object-fit: contain;
    filter: drop-shadow(0 6px 12px rgba(16, 22, 20, 0.24));
  }

  .utep-logo {
    height: 52px;
    width: auto;
  }

  .space-force-logo {
    height: 50px;
    width: auto;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
  }

  .top-row {
    display: grid;
    grid-template-columns: 1.35fr 0.95fr 0.95fr;
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
    transition: transform 180ms ease;
  }

  .globe-overlay span {
    color: var(--muted);
    font-size: 12px;
  }

  .summary {
    border-radius: 16px;
    padding: 18px;
    min-height: clamp(220px, 34vh, 320px);
    display: grid;
    align-content: start;
    gap: 14px;
    animation: panel-rise 260ms ease;
  }

  .summary h2 {
    margin: 0;
    font-size: 18px;
  }

  .card-header {
    display: grid;
    gap: 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.12);
  }

  .collision-summary {
    position: relative;
  }

  .collision-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .collision-header h2 {
    margin-bottom: 4px;
  }

  .collision-menu {
    display: grid;
    gap: 10px;
  }

  .collision-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 22, 20, 0.42);
    display: grid;
    place-items: center;
    z-index: 300;
  }

  .collision-modal {
    width: min(420px, 92vw);
    padding: 16px;
    border-radius: 14px;
    display: grid;
    gap: 14px;
    border: 1px solid var(--border);
  }

  .collision-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .collision-modal-header h2 {
    margin: 0;
    font-size: 18px;
  }

  .summary-grid {
    display: grid;
    gap: 12px;
  }

  .collision-menu label {
    display: grid;
    gap: 6px;
  }

  .summary-grid div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.08);
  }

  .collision-menu select {
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.74);
    color: var(--fg);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
  }

  .label {
    color: var(--muted);
    font-size: 13px;
  }

  .eyebrow {
    color: var(--accent);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
    padding: 18px;
    min-height: 280px;
    animation: panel-rise 320ms ease;
  }

  .section-header {
    display: grid;
    gap: 4px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.12);
  }

  .column h3 {
    margin: 0;
    font-size: 16px;
  }

  .sat-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px;
    margin-bottom: 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.62);
    color: var(--fg);
    text-align: left;
    cursor: pointer;
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      background-color 160ms ease;
  }

  .details-panel {
    border-radius: 16px;
    padding: 20px;
    display: grid;
    gap: 14px;
    animation: panel-rise 220ms ease;
    border: 1px solid rgba(127, 187, 179, 0.18);
    box-shadow: 0 18px 40px rgba(8, 10, 10, 0.18);
  }

  .details-inline {
    margin: -2px 0 12px;
  }

  .details-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.12);
  }

  .details-tabs {
    display: flex;
    gap: 4px;
    padding: 2px;
    border: 1px solid rgba(157, 169, 160, 0.12);
    border-radius: 10px;
    background: rgba(24, 29, 31, 0.42);
    width: fit-content;
  }

  .details-tabs button {
    border: 0;
    background: transparent;
    color: var(--muted);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1;
    min-height: 28px;
    cursor: pointer;
  }

  .details-tabs button.active {
    background: rgba(167, 192, 128, 0.16);
    color: var(--fg);
  }

  .details-panel h2,
  .details-panel strong {
    color: var(--fg);
  }

  .details-header-copy {
    display: grid;
    gap: 2px;
  }

  .details-section {
    display: grid;
    gap: 10px;
  }

  .details-grid {
    margin-top: 4px;
  }

  .details-fields {
    max-height: 280px;
    overflow: auto;
    padding-right: 4px;
  }

  .details-issue-row {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.62);
    display: grid;
    gap: 2px;
  }

  .sat-card:hover {
    transform: translateY(-1px);
    border-color: rgba(127, 187, 179, 0.22);
    background: rgba(28, 34, 36, 0.82);
  }

  .selected-card {
    border-color: rgba(127, 187, 179, 0.38);
    background: rgba(31, 40, 39, 0.96);
    box-shadow: inset 0 0 0 1px rgba(127, 187, 179, 0.12);
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

  .tracked-dot {
    background: #a7c080;
  }

  .debris-dot {
    background: #c5a46d;
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

  .tracked-badge {
    color: #a7c080;
    background: rgba(167, 192, 128, 0.14);
  }

  .debris-badge {
    color: #c5a46d;
    background: rgba(197, 164, 109, 0.14);
  }

  .empty {
    margin: 10px 0 0;
    color: var(--muted);
  }

  @keyframes panel-rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
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

    .header-actions-group {
      width: 100%;
      justify-items: stretch;
    }

    .header-logos {
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .header-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .header-actions .btn {
      flex: 1;
    }
  }

  @media (min-width: 5000px), (min-height: 3000px) {
    .dashboard {
      padding: 40px;
      gap: 28px;
    }

    .dashboard-header {
      border-radius: 24px;
      padding: 28px 32px;
      min-height: 148px;
      gap: 20px;
    }

    .dashboard-header h1 {
      font-size: 46px;
    }

    .dashboard-header p {
      font-size: 24px;
      margin-top: 10px;
    }

    .header-actions {
      gap: 14px;
    }

    .header-logos {
      gap: 20px;
    }

    .utep-logo {
      height: 74px;
    }

    .space-force-logo {
      height: 70px;
    }

    .top-row,
    .satellite-columns {
      gap: 24px;
    }

    .mini-globe-card,
    .summary {
      min-height: clamp(360px, 32vh, 520px);
      border-radius: 24px;
    }

    .summary {
      padding: 28px;
      gap: 20px;
    }

    .summary h2,
    .collision-modal-header h2 {
      font-size: 30px;
    }

    .label,
    .globe-overlay span {
      font-size: 20px;
    }

    .eyebrow {
      font-size: 16px;
    }

    .summary-grid {
      gap: 18px;
    }

    .summary-grid div {
      padding-bottom: 14px;
    }

    .column {
      border-radius: 24px;
      padding: 28px;
      min-height: 420px;
    }

    .column h3 {
      font-size: 28px;
    }

    .sat-card {
      padding: 18px;
      border-radius: 16px;
      gap: 16px;
    }

    .sat-name {
      font-size: 22px;
    }

    .issue {
      font-size: 18px;
    }

    .status-dot {
      width: 14px;
      height: 14px;
    }

    .badge {
      font-size: 14px;
      padding: 7px 12px;
    }
  }
</style>
