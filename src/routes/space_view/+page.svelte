<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { activeClassification } from '$lib/classification';
  import { fetchActiveAndDebrisTle, parseTle, propagateToGeodetic } from '$lib/tle';
  import * as satellite from 'satellite.js';
  import {
    activeConjunctions,
    initCollisionConfig,
    refreshConjunctions
  } from '$lib/conjunction';
  import { findConjunctionForSatellite } from '$lib/collisionUtils';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  let viewer;
  let CesiumLib;
  let loading = false;
  let error = '';
  let lastUpdated = '';
  let satelliteCount = 0;
  let dataSource = 'WARPCORE TLE';
  let refreshTimer;
  let positionTimer;
  let predictionTrajectories = [];
  let predictionLoading = false;
  let predictionError = '';
  let predictionRequestId = 0;
  let conjunctionSpots = [];
  let conjunctionMarker = null;
  let conjunctionLeftLabel = null;
  let conjunctionRightLabel = null;
  let hoverTooltip = null;
  let hoverX = 0;
  let hoverY = 0;
  let hoverHandler;
  let trajectoryRefreshTimer;
  const TRAJECTORY_CACHE_TTL_MS = 60 * 1000;
  const trajectoryPositionCache = new Map();
  const pendingTrajectoryRequests = new Map();
  let performanceMode = false;

  let allSatellites = [];
  let tracked = [];
  let displayCount = 10;
  let renderedSatelliteCount = 0;
  let trajectoryHours = 12;
  let selectedSat = null;
  let infoTab = 'telemetry';
  let enrichedFields = null;
  let enrichedLoading = false;
  let enrichedError = '';
  let filtersOpen = false;
  let filterLeo = true;
  let filterMeo = false;
  let filterGeo = false;
  let filterDebris = true;
  let showTrajectoryLines = false;
  let showAnomalyTrajectoryLines = true;
  let trajectoryScope = 'selected';
  let overlayMinimized = false;
  let infoMinimized = false;
  let displayMinimized = false;
  let selectedTrajectorySatelliteNumber = null;
  let focusedConjunctionSatelliteNumbers = [];
  let focusedConjunctionEvent = null;
  const LEO_MAX_KM = 2000;
  const MEO_MAX_KM = 35786;
  const MAX_PROTOTYPE_SATELLITES = 2000;
  const SAT_ICON_BLUE = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<rect x="13" y="10" width="6" height="12" rx="2" fill="#7fbbb3"/>' +
      '<rect x="6" y="12" width="6" height="8" rx="1" fill="#a7c080"/>' +
      '<rect x="20" y="12" width="6" height="8" rx="1" fill="#a7c080"/>' +
      '<circle cx="16" cy="16" r="2" fill="#1e2326"/>' +
    '</svg>'
  );
  const SAT_ICON_RED = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<rect x="13" y="10" width="6" height="12" rx="2" fill="#e69875"/>' +
      '<rect x="6" y="12" width="6" height="8" rx="1" fill="#d6996b"/>' +
      '<rect x="20" y="12" width="6" height="8" rx="1" fill="#d6996b"/>' +
      '<circle cx="16" cy="16" r="2" fill="#1e2326"/>' +
    '</svg>'
  );
  const SAT_ICON_DEBRIS = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<path d="M16 4 L24 7 L28 14 L25 23 L17 28 L9 25 L4 17 L7 8 Z" fill="#dbbc7f"/>' +
      '<path d="M11 12 L21 20 M20 11 L12 21" stroke="#1e2326" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="6.5" cy="6.5" r="1.5" fill="#e6c384"/>' +
      '<circle cx="26" cy="9" r="1.2" fill="#e6c384"/>' +
      '<circle cx="24.5" cy="25" r="1.3" fill="#e6c384"/>' +
    '</svg>'
  );
  const WARN_ICON = svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<path d="M16 4 L29 28 H3 Z" fill="#dbbc7f"/>' +
      '<rect x="15" y="11" width="2" height="9" fill="#1f1400"/>' +
      '<rect x="15" y="22.5" width="2" height="2" fill="#1f1400"/>' +
    '</svg>'
  );

  onMount(async () => {
    if (!browser) return;
    await loadRuntimeConfig();
    initCollisionConfig();

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
        skyBox: new CesiumLib.SkyBox({
          sources: {
            positiveX: '/skybox/px.jpg',
            negativeX: '/skybox/nx.jpg',
            positiveY: '/skybox/py.jpg',
            negativeY: '/skybox/ny.jpg',
            positiveZ: '/skybox/pz.jpg',
            negativeZ: '/skybox/nz.jpg'
          }
        }),
        skyAtmosphere: false,
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

    viewer.scene.globe.enableLighting = !performanceMode;
    viewer.scene.fog.enabled = !performanceMode;
    viewer.scene.globe.show = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 120000;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;
    viewer.scene.backgroundColor = CesiumLib.Color.BLACK;
    viewer.cesiumWidget.creditContainer.style.display = 'none';

    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity) {
        selectedSat = null;
        selectedTrajectorySatelliteNumber = null;
        focusedConjunctionSatelliteNumbers = [];
        focusedConjunctionEvent = null;
        infoTab = 'telemetry';
        clearPredictionTrajectories();
        return;
      }
      if (entity.__conjunctionMarkerEntity && entity.__conjunctionEvent) {
        activateConjunctionFocus(entity.__conjunctionEvent);
        return;
      }
      if (entity.__trajectoryEntity) {
        return;
      }
      const match = tracked.find((item) => item.entity === entity);
      if (!match) {
        return;
      }
      selectedSat = match.meta;
      selectedTrajectorySatelliteNumber = match.meta?.satelliteNumber ?? null;
      focusedConjunctionSatelliteNumbers = [];
      focusedConjunctionEvent = match.meta?.anomaly
        ? findConjunctionForSatellite($activeConjunctions, match.meta?.satelliteNumber)
        : null;
      infoTab = 'telemetry';
      void loadEnrichedForSelected();
    });

    hoverHandler = new CesiumLib.ScreenSpaceEventHandler(viewer.scene.canvas);
    hoverHandler.setInputAction((movement) => {
      if (!viewer || !CesiumLib) return;
      const picked = viewer.scene.pick(movement.endPosition);
      const entity = picked?.id;
      if (!entity || entity.__trajectoryEntity || entity.__conjunctionMarkerEntity) {
        hoverTooltip = null;
        return;
      }
      const match = tracked.find((item) => item.entity === entity);
      if (!match?.meta) {
        hoverTooltip = null;
        return;
      }
      hoverX = movement.endPosition.x;
      hoverY = movement.endPosition.y;
      hoverTooltip = {
        name: match.meta.name,
        status: match.meta.anomaly ? 'ANOMALY' : match.meta.objectType,
        orbitBand: match.meta.orbitBand,
        altKm: match.meta.altKm
      };
    }, CesiumLib.ScreenSpaceEventType.MOUSE_MOVE);

    await loadData();

    refreshTimer = setInterval(loadData, 10 * 60 * 1000);
    positionTimer = setInterval(updatePositions, 5000);
    trajectoryRefreshTimer = setInterval(() => {
      if (!viewer || !CesiumLib || !showTrajectoryLines) {
        return;
      }
      clearTrajectoryCache();
      void loadPredictionTrajectories();
    }, TRAJECTORY_CACHE_TTL_MS);
  });

  async function loadRuntimeConfig() {
    try {
      const response = await fetch('/api/runtime-config');
      if (!response.ok) {
        return;
      }
      const config = await response.json();
      performanceMode = config?.demoPerformanceMode === true;
      displayCount = performanceMode ? 6 : 10;
    } catch {
      performanceMode = false;
      displayCount = 10;
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

  function svgData(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  onDestroy(() => {
    clearInterval(refreshTimer);
    clearInterval(positionTimer);
    clearInterval(trajectoryRefreshTimer);
    if (hoverHandler) {
      hoverHandler.destroy();
    }
    clearPredictionTrajectories();
    clearConjunctionSpots();
    clearConjunctionMarkerLabels();
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
      await refreshConjunctions(activeSats);
      dataSource = source;
      lastUpdated = new Date().toLocaleString();
      allSatellites = [...activeSats, ...debrisSats];
      clearTrajectoryCache();
      satelliteCount = allSatellites.length;
      rebuildEntities();
      if (selectedSat?.satelliteNumber) {
        const match = tracked.find((item) => item.meta?.satelliteNumber === selectedSat.satelliteNumber);
        if (match) {
          selectedSat = match.meta;
          selectedTrajectorySatelliteNumber = match.meta?.satelliteNumber ?? null;
        }
      }
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
      if (selectedSat && item.meta && selectedSat.name === item.meta.name) {
        selectedSat.lat = shifted.lat.toFixed(3);
        selectedSat.lon = shifted.lon.toFixed(3);
        selectedSat.altKm = shifted.altKm.toFixed(1);
      }
    }
    if (predictionTrajectories.length) {
      clearTrajectoryCache();
      void refreshTrajectoryEntityPositions();
    }
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
    clearPredictionTrajectories();
    clearConjunctionSpots();
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
        return true;
      });
    const satelliteVisible = visible.filter(({ sat }) => !sat.isDebris);
    const debrisVisible = visible.filter(({ sat }) => sat.isDebris);
    const actualVisible = [...satelliteVisible, ...debrisVisible];
    const anomalySatelliteNumbers = new Set(
      $activeConjunctions.flatMap((event) => [event.primarySatelliteNumber, event.secondarySatelliteNumber])
    );
    satelliteCount = actualVisible.length;
    renderedSatelliteCount = actualVisible.length
      ? Math.min(Math.max(1, displayCount), Math.min(actualVisible.length, MAX_PROTOTYPE_SATELLITES))
      : 0;
    const selectedBase = actualVisible.slice(0, renderedSatelliteCount);
    const forcedAnomalies = actualVisible.filter(({ sat }) =>
      anomalySatelliteNumbers.has(sat.fields.satelliteNumber)
    );
    const selected = [...selectedBase, ...forcedAnomalies].filter(
      ({ sat }, index, items) =>
        items.findIndex((candidate) => candidate.sat.fields.satelliteNumber === sat.fields.satelliteNumber) === index
    );
    for (let i = 0; i < selected.length; i += 1) {
      const { sat, geo } = selected[i];
      const latOffset = 0;
      const lonOffset = 0;
      const shifted = applyGeoOffset(geo, latOffset, lonOffset);
      const conjunction = findConjunctionForSatellite($activeConjunctions, sat.fields.satelliteNumber);
      const anomaly = Boolean(conjunction);
      const status = sat.isDebris ? 'DEBRIS' : 'TRACKED';
      const position = CesiumLib.Cartesian3.fromDegrees(
        shifted.lon,
        shifted.lat,
        shifted.altKm * 1000
      );
      const displayName = sat.name;
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
      tracked.push({
        satrec: sat.satrec,
        latOffset,
        lonOffset,
        entity,
        warnEntity,
        meta: {
          name: displayName,
          status,
          anomaly,
          objectType: sat.isDebris ? 'Debris' : 'Satellite',
          orbitBand: getOrbitBand(geo.altKm),
          lat: shifted.lat.toFixed(3),
          lon: shifted.lon.toFixed(3),
          altKm: shifted.altKm.toFixed(1),
          classification: sat.fields.classification,
          satelliteNumber: sat.fields.satelliteNumber,
          internationalDesignator: sat.fields.internationalDesignator,
          epochIso: sat.fields.epochIso,
          inclination: sat.fields.inclination.toFixed(4),
          raan: sat.fields.raan.toFixed(4),
          eccentricity: sat.fields.eccentricity.toFixed(7),
          argumentOfPerigee: sat.fields.argumentOfPerigee.toFixed(4),
          meanAnomaly: sat.fields.meanAnomaly.toFixed(4),
          meanMotion: sat.fields.meanMotion.toFixed(8),
          revolutionsAtEpoch: Number.isFinite(sat.fields.revolutionsAtEpoch)
            ? String(sat.fields.revolutionsAtEpoch)
            : 'Unknown',
          collisionDistanceKm: conjunction ? conjunction.distanceKm.toFixed(2) : null,
          collisionTimeIso: conjunction?.timeIso ?? null,
          line1: sat.line1,
          line2: sat.line2
        }
      });
    }
    updatePositions();
  }

  function clearPredictionTrajectories() {
    predictionError = '';
    predictionLoading = false;
    if (viewer && predictionTrajectories.length) {
      for (const entity of predictionTrajectories) {
        viewer.entities.remove(entity);
      }
    }
    predictionTrajectories = [];
  }

  function clearTrajectoryCache() {
    trajectoryPositionCache.clear();
    pendingTrajectoryRequests.clear();
  }

  function clearConjunctionSpots() {
    if (!viewer) return;
    for (const entity of conjunctionSpots) {
      viewer.entities.remove(entity);
    }
    conjunctionSpots = [];
  }

  function clearConjunctionMarkerLabels() {
    if (!viewer) return;
    if (conjunctionMarker) viewer.entities.remove(conjunctionMarker);
    if (conjunctionLeftLabel) viewer.entities.remove(conjunctionLeftLabel);
    if (conjunctionRightLabel) viewer.entities.remove(conjunctionRightLabel);
    conjunctionMarker = null;
    conjunctionLeftLabel = null;
    conjunctionRightLabel = null;
  }

  function activateConjunctionFocus(event) {
    if (!event) return;
    focusedConjunctionSatelliteNumbers = [
      event.primarySatelliteNumber,
      event.secondarySatelliteNumber
    ].filter(Boolean);
    focusedConjunctionEvent = event;
    showTrajectoryLines = true;
    trajectoryScope = 'selected';

    const primaryMatch = tracked.find(
      (item) => item.meta?.satelliteNumber === event.primarySatelliteNumber
    );
    if (!primaryMatch?.meta) {
      return;
    }

    selectedSat = primaryMatch.meta;
    selectedTrajectorySatelliteNumber = primaryMatch.meta.satelliteNumber ?? null;
    infoTab = 'risk';
    void loadEnrichedForSelected();
  }

  async function loadPredictionTrajectories() {
    if (!viewer || !CesiumLib) return;

    const manualTargets = showTrajectoryLines
      ? focusedConjunctionSatelliteNumbers.length
        ? tracked
            .map((item) => item.meta)
            .filter(
              (meta) =>
                meta?.line1 &&
                meta?.line2 &&
                focusedConjunctionSatelliteNumbers.includes(meta.satelliteNumber)
            )
        : trajectoryScope === 'all'
          ? tracked.map((item) => item.meta).filter((meta) => meta?.line1 && meta?.line2)
          : selectedTrajectorySatelliteNumber
            ? tracked
                .map((item) => item.meta)
                .filter(
                  (meta) =>
                    meta?.satelliteNumber === selectedTrajectorySatelliteNumber && meta?.line1 && meta?.line2
                )
            : []
      : [];

    const anomalyTargets = showAnomalyTrajectoryLines
      ? tracked
          .map((item) => item.meta)
          .filter(
            (meta) =>
              meta?.line1 &&
              meta?.line2 &&
              (focusedConjunctionSatelliteNumbers.length
                ? focusedConjunctionSatelliteNumbers.includes(meta.satelliteNumber)
                : meta?.anomaly)
          )
      : [];

    const targets = [...manualTargets, ...anomalyTargets].filter(
        (meta, index, items) =>
          meta &&
          items.findIndex((candidate) => candidate?.satelliteNumber === meta.satelliteNumber) === index
      );

    if (!targets.length) {
      clearPredictionTrajectories();
      return;
    }

    predictionLoading = true;
    predictionError = '';
    const requestId = ++predictionRequestId;

    try {
      const targetSatelliteNumbers = new Set(targets.map((meta) => meta.satelliteNumber));

      if (viewer && predictionTrajectories.length) {
        for (const entity of predictionTrajectories) {
          if (!targetSatelliteNumbers.has(entity.__satelliteNumber)) {
            viewer.entities.remove(entity);
          }
        }
      }

      const entities = [];

      for (const meta of targets) {
        const positions = await getCachedTrajectoryPositions(
          meta,
          trajectoryHours,
          getTrajectoryConjunctionEvent(meta) ?? null
        );
        if (!positions || requestId !== predictionRequestId) {
          continue;
        }

        let entity = predictionTrajectories.find((candidate) => candidate.__satelliteNumber === meta.satelliteNumber);

        if (!entity) {
          const mutablePositions = positions.slice();
          entity = viewer.entities.add({
            polyline: {
              positions: mutablePositions,
              width: trajectoryWidth(meta),
              material: trajectoryMaterial(meta),
              clampToGround: false
            }
          });
          entity.__trajectoryEntity = true;
          entity.__satelliteNumber = meta.satelliteNumber;
          entity.__trajectoryPositions = mutablePositions;
        } else {
          syncTrajectoryPositions(entity, positions);
          entity.polyline.width = trajectoryWidth(meta);
          entity.polyline.material = trajectoryMaterial(meta);
        }

        entities.push(entity);
      }

      if (requestId !== predictionRequestId) {
        return;
      }

      predictionTrajectories = entities;
    } catch (err) {
      if (requestId !== predictionRequestId) {
        return;
      }
      predictionError = err instanceof Error ? err.message : 'Prediction failed.';
    } finally {
      if (requestId === predictionRequestId) {
        predictionLoading = false;
      }
    }
  }

  function getTrajectoryConjunctionEvent(meta) {
    if (focusedConjunctionEvent) {
      if (
        focusedConjunctionEvent.primarySatelliteNumber === meta.satelliteNumber ||
        focusedConjunctionEvent.secondarySatelliteNumber === meta.satelliteNumber
      ) {
        return focusedConjunctionEvent;
      }
    }

    if (meta.anomaly) {
      return findConjunctionForSatellite($activeConjunctions, meta.satelliteNumber) ?? null;
    }

    return null;
  }

  function getTrajectoryCacheKey(meta, hours) {
    return `${meta.satelliteNumber}:${meta.line1}:${meta.line2}:${hours}`;
  }

  async function refreshTrajectoryEntityPositions() {
    if (!viewer || !CesiumLib || !predictionTrajectories.length) {
      return;
    }

    for (const entity of predictionTrajectories) {
      const meta = tracked.find((item) => item.meta?.satelliteNumber === entity.__satelliteNumber)?.meta;
      if (!meta) {
        continue;
      }

      const positions = await getCachedTrajectoryPositions(
        meta,
        trajectoryHours,
        getTrajectoryConjunctionEvent(meta) ?? null
      );
      if (!positions) {
        continue;
      }

      syncTrajectoryPositions(entity, positions);
    }
  }

  function syncTrajectoryPositions(entity, nextPositions) {
    if (!entity.__trajectoryPositions) {
      entity.__trajectoryPositions = nextPositions.slice();
      entity.polyline.positions = entity.__trajectoryPositions;
      return;
    }

    entity.__trajectoryPositions.length = nextPositions.length;
    for (let i = 0; i < nextPositions.length; i += 1) {
      entity.__trajectoryPositions[i] = nextPositions[i];
    }
  }

  function trajectoryWidth(meta) {
    return meta.anomaly ? 2.6 : meta.satelliteNumber === selectedTrajectorySatelliteNumber ? 2.8 : 1.8;
  }

  function trajectoryMaterial(meta) {
    return !meta.anomaly &&
      trajectoryScope === 'selected' &&
      meta.satelliteNumber === selectedTrajectorySatelliteNumber
      ? new CesiumLib.PolylineDashMaterialProperty({
          color: predictionColor(meta).withAlpha(0.88),
          gapColor: CesiumLib.Color.TRANSPARENT,
          dashLength: 18
        })
      : predictionColor(meta).withAlpha(
          meta.satelliteNumber === selectedTrajectorySatelliteNumber ? 0.82 : 0.48
        );
  }

  async function getCachedTrajectoryPositions(meta, hours, conjunctionEvent = null) {
    const key = `${getTrajectoryCacheKey(meta, hours)}:${conjunctionEvent?.timeIso ?? 'none'}`;
    const cached = trajectoryPositionCache.get(key);
    const now = Date.now();

    if (cached && now - cached.generatedAt < TRAJECTORY_CACHE_TTL_MS) {
      return cached.positions;
    }

    if (pendingTrajectoryRequests.has(key)) {
      return pendingTrajectoryRequests.get(key);
    }

    const request = fetchModelTrajectoryPositions(meta, hours, conjunctionEvent, now)
      .then((positions) => {
        if (!positions?.length) {
          return null;
        }

        trajectoryPositionCache.set(key, {
          generatedAt: Date.now(),
          positions
        });
        return positions;
      })
      .finally(() => {
        pendingTrajectoryRequests.delete(key);
      });

    pendingTrajectoryRequests.set(key, request);
    return request;
  }

  async function fetchModelTrajectoryPositions(meta, hours, conjunctionEvent, nowMs) {
    const horizonEnd = nowMs + hours * 60 * 60 * 1000;
    const eventEnd = conjunctionEvent?.timeIso ? new Date(conjunctionEvent.timeIso).getTime() : NaN;
    const effectiveEnd = Number.isFinite(eventEnd) && eventEnd > nowMs ? eventEnd : horizonEnd;
    const durationMinutes = Math.max(1, Math.ceil((effectiveEnd - nowMs) / (60 * 1000)));
    const preserveCollisionFidelity = Boolean(conjunctionEvent || meta.anomaly);
    const stepMinutes = performanceMode && !preserveCollisionFidelity ? 20 : 10;
    const requestHours = Math.max(1, Math.ceil(durationMinutes / 60));

    const response = await fetch('/api/tle-prediction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: meta.name,
        line1: meta.line1,
        line2: meta.line2,
        hours: requestHours,
        stepMinutes
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ?? 'Prediction request failed.');
    }

    const relevantSamples = (payload.samples ?? []).filter((sample) => {
      const sampleTime = new Date(sample.isoTime).getTime();
      return Number.isFinite(sampleTime) && sampleTime >= nowMs && sampleTime <= effectiveEnd;
    });

    if (!relevantSamples.length) {
      return null;
    }

    const positions = [];
    for (const sample of relevantSamples) {
      const sampleTime = new Date(sample.isoTime);
      const temePosition = toEciVector(sample.positionKm);
      if (!temePosition) {
        continue;
      }

      const gmst = satellite.gstime(sampleTime);
      const geodetic = satellite.eciToGeodetic(temePosition, gmst);
      positions.push(
        CesiumLib.Cartesian3.fromDegrees(
          satellite.degreesLong(geodetic.longitude),
          satellite.degreesLat(geodetic.latitude),
          geodetic.height * 1000
        )
      );
    }

    if (!positions.length) {
      return null;
    }

    if (conjunctionEvent) {
      positions[positions.length - 1] = CesiumLib.Cartesian3.fromDegrees(
        conjunctionEvent.markerLon,
        conjunctionEvent.markerLat,
        conjunctionEvent.markerAltKm * 1000
      );
    }

    return positions;
  }

  function toEciVector(positionKm) {
    const [x, y, z] = positionKm ?? [];
    if (![x, y, z].every((value) => Number.isFinite(value))) {
      return null;
    }
    return { x, y, z };
  }

  function updateConjunctionSpots() {
    if (!viewer || !CesiumLib) return;
    clearConjunctionSpots();
    if (showAnomalyTrajectoryLines) {
      return;
    }

    conjunctionSpots = $activeConjunctions.map((event) => {
      const entity = viewer.entities.add({
        position: CesiumLib.Cartesian3.fromDegrees(
          event.markerLon,
          event.markerLat,
          event.markerAltKm * 1000
        ),
        point: {
          pixelSize: 10,
          color: CesiumLib.Color.fromCssColorString('#e67e80'),
          outlineColor: CesiumLib.Color.fromCssColorString('#f4f1de'),
          outlineWidth: 2
        }
      });
      entity.__conjunctionMarkerEntity = true;
      entity.__conjunctionEvent = event;
      return entity;
    });
  }

  function updateFocusedConjunctionMarker() {
    if (!viewer || !CesiumLib) return;
    clearConjunctionMarkerLabels();

    const event =
      focusedConjunctionEvent ||
      (selectedSat?.anomaly
        ? findConjunctionForSatellite($activeConjunctions, selectedSat.satelliteNumber)
        : null);

    if (!event) {
      return;
    }

    const basePosition = CesiumLib.Cartesian3.fromDegrees(
      event.markerLon,
      event.markerLat,
      event.markerAltKm * 1000
    );

    conjunctionMarker = viewer.entities.add({
      position: basePosition,
      point: {
        pixelSize: 10,
        color: CesiumLib.Color.fromCssColorString('#e67e80'),
        outlineColor: CesiumLib.Color.fromCssColorString('#f4f1de'),
        outlineWidth: 2
      }
    });
    conjunctionMarker.__conjunctionMarkerEntity = true;

    conjunctionLeftLabel = viewer.entities.add({
      position: basePosition,
      label: {
        text: `${event.distanceKm.toFixed(2)} km`,
        font: '12px sans-serif',
        fillColor: CesiumLib.Color.fromCssColorString('#f4f1de'),
        showBackground: true,
        backgroundColor: CesiumLib.Color.fromBytes(30, 35, 38, 220),
        pixelOffset: new CesiumLib.Cartesian2(-84, 0),
        horizontalOrigin: CesiumLib.HorizontalOrigin.RIGHT,
        verticalOrigin: CesiumLib.VerticalOrigin.CENTER
      }
    });
    conjunctionLeftLabel.__conjunctionMarkerEntity = true;

    conjunctionRightLabel = viewer.entities.add({
      position: basePosition,
      label: {
        text: `${new Date(event.timeIso).toLocaleString()} • ${event.markerLat.toFixed(2)}°, ${event.markerLon.toFixed(2)}°`,
        font: '12px sans-serif',
        fillColor: CesiumLib.Color.fromCssColorString('#f4f1de'),
        showBackground: true,
        backgroundColor: CesiumLib.Color.fromBytes(30, 35, 38, 220),
        pixelOffset: new CesiumLib.Cartesian2(84, 0),
        horizontalOrigin: CesiumLib.HorizontalOrigin.LEFT,
        verticalOrigin: CesiumLib.VerticalOrigin.CENTER
      }
    });
    conjunctionRightLabel.__conjunctionMarkerEntity = true;
  }

  async function loadEnrichedForSelected() {
    enrichedFields = null;
    enrichedError = '';
    if (!selectedSat?.satelliteNumber) return;
    try {
      enrichedLoading = true;
      const res = await fetch(`/api/enriched?satelliteNumber=${encodeURIComponent(selectedSat.satelliteNumber)}`, {
        cache: 'no-store'
      });
      if (!res.ok) {
        throw new Error(`Enriched data error: ${res.status}`);
      }
      const data = await res.json();
      enrichedFields = Array.isArray(data?.fields) ? data.fields : [];
    } catch (err) {
      enrichedError = err instanceof Error ? err.message : 'Failed to load enriched data';
    } finally {
      enrichedLoading = false;
    }
  }

  function predictionColor(meta = selectedSat) {
    if (!meta || !CesiumLib) {
      return CesiumLib.Color.fromCssColorString('#a7c080');
    }
    if (meta.objectType === 'Debris') {
      return CesiumLib.Color.fromCssColorString('#c5a46d');
    }
    if (meta.anomaly) {
      return CesiumLib.Color.fromCssColorString('#c85d6c');
    }
    return CesiumLib.Color.fromCssColorString('#a7c080');
  }

  function handleLogout() {
    window.location.href = '/auth/logout';
  }

  function handleDashboard() {
    window.location.href = '/dashboard';
  }

  $: if (viewer && CesiumLib) {
    displayCount;
    filterLeo;
    filterMeo;
    filterGeo;
    filterDebris;
    rebuildEntities();
  }

  $: if (viewer && CesiumLib) {
    showTrajectoryLines;
    showAnomalyTrajectoryLines;
    trajectoryHours;
    trajectoryScope;
    selectedTrajectorySatelliteNumber;
    focusedConjunctionSatelliteNumbers.join('|');
    tracked.length;
    void loadPredictionTrajectories();
  }

  $: if (!showAnomalyTrajectoryLines && focusedConjunctionSatelliteNumbers.length) {
    if (!showTrajectoryLines) {
      focusedConjunctionSatelliteNumbers = [];
    }
  }

  $: if (viewer && CesiumLib) {
    showAnomalyTrajectoryLines;
    $activeConjunctions;
    updateConjunctionSpots();
  }

  $: if (viewer && CesiumLib) {
    selectedSat?.satelliteNumber;
    selectedSat?.anomaly;
    focusedConjunctionEvent?.timeIso;
    $activeConjunctions;
    updateFocusedConjunctionMarker();
  }

  $: if (viewer && CesiumLib) {
    selectedSat?.satelliteNumber;
    void loadEnrichedForSelected();
  }
</script>

<svelte:head>
  <title>Real-Time Conjunction Analyzer | Space View</title>
</svelte:head>

<div class="space-view">
  <div id="cesiumContainer"></div>

  <div class="overlay glass fade-in">
    <div class="overlay-header">
      <div class="overlay-header-main">
        <div class="overlay-title">
          <span class="eyebrow">Orbital Operations</span>
          <h2>Real-Time Conjunction Analyzer | Space View</h2>
        </div>
        <button class="panel-toggle btn secondary" on:click={() => (overlayMinimized = !overlayMinimized)}>
          {overlayMinimized ? 'Expand' : 'Minimize'}
        </button>
      </div>
      <div class="actions">
        <button class="btn" on:click={loadData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
        <button class="btn secondary" on:click={handleDashboard}>Dashboard</button>
        <button class="btn danger" on:click={handleLogout}>Logout</button>
      </div>
    </div>

    {#if !overlayMinimized}
    <div class="legend">
      <span class="legend-item"><span class="dot nominal"></span> Normal</span>
      <span class="legend-item"><span class="dot anomaly"></span> Anomaly</span>
      <span class="legend-item"><span class="dot debris"></span> Debris</span>
    </div>

    <div class="stats">
      <div class="stat-row">
        <span class="label">Satellites loaded</span>
        <strong>{satelliteCount}</strong>
      </div>
      <div class="stat-row">
        <span class="label">Data source</span>
        <strong>{dataSource}</strong>
      </div>
      <div class="stat-row">
        <span class="label">Trajectory engine</span>
        <strong>SGP4</strong>
      </div>
      <div class="stat-row">
        <span class="label">Classification</span>
        <strong>{$activeClassification}</strong>
      </div>
      <div class="stat-row">
        <span class="label">Last updated</span>
        <strong>{lastUpdated || 'Loading...'}</strong>
      </div>
    </div>

    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if predictionError}
      <div class="error">{predictionError}</div>
    {/if}
    {/if}
  </div>

  <div class:controls-minimized={(showTrajectoryLines || showAnomalyTrajectoryLines) && displayMinimized} class="controls glass fade-in">
    <div class="controls-header">
      <div class="section-heading">Display</div>
      {#if showTrajectoryLines || showAnomalyTrajectoryLines}
        <button class="panel-toggle btn secondary" on:click={() => (displayMinimized = !displayMinimized)}>
          {displayMinimized ? 'Expand' : 'Minimize'}
        </button>
      {/if}
    </div>

    {#if !(showTrajectoryLines || showAnomalyTrajectoryLines) || !displayMinimized}
      {#if showTrajectoryLines}
        <div class="panel-section">
          <div class="control">
            <div class="control-header">
              <span>Satellites to view</span>
              <strong>{renderedSatelliteCount}</strong>
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
        </div>
      {/if}

      {#if showTrajectoryLines || showAnomalyTrajectoryLines}
        <div class="panel-section">
          <div class="control">
            <div class="control-header">
              <span>Trajectory hours</span>
              <strong>{trajectoryHours}h</strong>
            </div>
            <input
              class="range"
              type="range"
              min="1"
              max="240"
              step="1"
              bind:value={trajectoryHours}
            />
            {#if predictionLoading}
              <div class="label">Drawing propagated trajectory...</div>
            {/if}
          </div>
        </div>
      {/if}
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
        <label><input type="checkbox" bind:checked={showTrajectoryLines} /> Trajectory lines</label>
        {#if showTrajectoryLines}
          <label class="trajectory-scope">
            <span>Trajectory scope</span>
            <select bind:value={trajectoryScope}>
              <option value="selected">Selected satellite</option>
              <option value="all">All visible satellites</option>
            </select>
          </label>
        {/if}
        <label><input type="checkbox" bind:checked={showAnomalyTrajectoryLines} /> Anomaly trajectory lines</label>
      </div>
    </div>
  </div>

  {#if selectedSat}
    <div class:info-minimized={infoMinimized} class="info glass fade-in">
      <div class="info-heading">
        <div>
          <span class="eyebrow">Selected Object</span>
          <h3>{selectedSat.name}</h3>
        </div>
        <div class="info-heading-actions">
          <span class:selected-anomaly={selectedSat.anomaly} class="operator-badge">
            {selectedSat.anomaly ? 'ANOMALY' : selectedSat.objectType.toUpperCase()}
          </span>
          <button class="panel-toggle btn secondary" on:click={() => (infoMinimized = !infoMinimized)}>
            {infoMinimized ? 'Expand' : 'Minimize'}
          </button>
        </div>
      </div>
      {#if !infoMinimized}
      <div class="tabs">
        <button class:active={infoTab === 'telemetry'} on:click={() => (infoTab = 'telemetry')}>
          Telemetry
        </button>
        <button class:active={infoTab === 'orbit'} on:click={() => (infoTab = 'orbit')}>Orbit</button>
        <button class:active={infoTab === 'risk'} on:click={() => (infoTab = 'risk')}>Risk</button>
        <button class:active={infoTab === 'missions'} on:click={() => (infoTab = 'missions')}>Missions</button>
      </div>

      {#if infoTab === 'telemetry'}
        <div class="info-grid">
          <div>
            <span class="label">Status</span>
            <strong class:warn={selectedSat.anomaly}>{selectedSat.anomaly ? 'ANOMALY' : selectedSat.status}</strong>
          </div>
          <div><span class="label">Object</span><strong>{selectedSat.objectType}</strong></div>
          <div><span class="label">Satellite #</span><strong>{selectedSat.satelliteNumber}</strong></div>
          <div><span class="label">TLE class</span><strong>{selectedSat.classification}</strong></div>
          <div><span class="label">Designator</span><strong>{selectedSat.internationalDesignator || '—'}</strong></div>
          <div><span class="label">Epoch</span><strong>{selectedSat.epochIso}</strong></div>
        </div>
      {/if}

      {#if infoTab === 'orbit'}
        <div class="info-grid">
          <div><span class="label">Orbit band</span><strong>{selectedSat.orbitBand}</strong></div>
          <div><span class="label">Latitude</span><strong>{selectedSat.lat || '—'}</strong></div>
          <div><span class="label">Longitude</span><strong>{selectedSat.lon || '—'}</strong></div>
          <div><span class="label">Altitude</span><strong>{selectedSat.altKm || '—'} km</strong></div>
          <div><span class="label">Inclination</span><strong>{selectedSat.inclination}°</strong></div>
          <div><span class="label">RAAN</span><strong>{selectedSat.raan}°</strong></div>
          <div><span class="label">Eccentricity</span><strong>{selectedSat.eccentricity}</strong></div>
          <div><span class="label">Arg. perigee</span><strong>{selectedSat.argumentOfPerigee}°</strong></div>
          <div><span class="label">Mean anomaly</span><strong>{selectedSat.meanAnomaly}°</strong></div>
          <div><span class="label">Mean motion</span><strong>{selectedSat.meanMotion}</strong></div>
        </div>
      {/if}

      {#if infoTab === 'risk'}
        <div class="info-grid">
          <div><span class="label">Catalog type</span><strong>{selectedSat.objectType}</strong></div>
          <div><span class="label">App classification</span><strong>{$activeClassification}</strong></div>
          <div><span class="label">Trajectory horizon</span><strong>{trajectoryHours} hours</strong></div>
          <div><span class="label">Engine status</span><strong>{predictionLoading ? 'Running' : 'Ready'}</strong></div>
          <div><span class="label">Epoch revolutions</span><strong>{selectedSat.revolutionsAtEpoch}</strong></div>
          <div><span class="label">Closest approach</span><strong>{selectedSat.collisionDistanceKm ? `${selectedSat.collisionDistanceKm} km` : 'None'}</strong></div>
          <div><span class="label">Expected time</span><strong>{selectedSat.collisionTimeIso ? new Date(selectedSat.collisionTimeIso).toLocaleString() : 'None'}</strong></div>
        </div>
      {/if}

      {#if infoTab === 'missions'}
        {#if enrichedLoading}
          <div class="label">Loading enriched fields…</div>
        {:else if enrichedError}
          <div class="error">{enrichedError}</div>
        {:else if enrichedFields && enrichedFields.length}
          <div class="info-grid">
            {#each enrichedFields as field}
              <div><span class="label">{field.label}</span><strong>{field.value}</strong></div>
            {/each}
          </div>
        {:else}
          <div class="label">No enriched fields found for this satellite.</div>
        {/if}
      {/if}
      {/if}

    </div>
  {/if}

  {#if hoverTooltip}
    <div
      class="hover-tooltip glass"
      style={`left:${hoverX + 14}px; top:${hoverY + 14}px;`}
    >
      <strong>{hoverTooltip.name}</strong>
      <span>{hoverTooltip.status}</span>
      <span>{hoverTooltip.orbitBand} • {hoverTooltip.altKm} km</span>
    </div>
  {/if}
</div>

<style>
  .space-view {
    position: relative;
    width: 100vw;
    height: calc(100vh - var(--classification-bar-height));
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
    padding: 16px 18px;
    border-radius: 16px;
    width: min(380px, 86vw);
    display: grid;
    gap: 12px;
    animation: panel-slide 240ms ease;
  }

  .overlay-header {
    display: grid;
    gap: 10px;
  }

  .overlay-header h2 {
    margin: 0;
    font-size: 16px;
    letter-spacing: 0.02em;
  }

  .overlay-title {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .overlay-header-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .panel-toggle {
    white-space: nowrap;
  }

  .stats {
    display: grid;
    gap: 12px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    padding-top: 8px;
    border-top: 1px solid rgba(157, 169, 160, 0.12);
  }

  .label {
    color: var(--muted);
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
    background: #a7c080;
  }

  .dot.anomaly {
    background: #e67e80;
  }

  .dot.debris {
    background: #c5a46d;
  }

  .controls {
    position: absolute;
    bottom: 24px;
    left: 24px;
    padding: 12px;
    border-radius: 16px;
    width: min(292px, 82vw);
    display: grid;
    gap: 12px;
    animation: panel-slide 300ms ease;
  }

  .controls-minimized {
    width: auto;
    min-width: 0;
    padding: 10px 12px;
    gap: 0;
  }

  .controls-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .info {
    position: absolute;
    top: 24px;
    right: 24px;
    padding: 16px;
    border-radius: 16px;
    width: min(380px, 92vw);
    display: grid;
    gap: 8px;
    min-height: 0;
    max-height: calc(100vh - var(--classification-bar-height) - 48px);
    overflow: auto;
    animation: panel-slide 280ms ease;
  }

  .info-minimized {
    min-height: 0;
    width: min(260px, 72vw);
  }

  .filters-shell {
    position: absolute;
    left: 0;
    top: calc(50% + 56px);
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 3;
  }

  .filters-toggle {
    border: 1px solid var(--border);
    border-radius: 0 12px 12px 0;
    padding: 10px 12px;
    background: rgba(24, 29, 31, 0.8);
    color: var(--fg);
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
  }

  .filters {
    width: 216px;
    padding: 12px;
    border-radius: 12px;
    margin-left: 8px;
    opacity: 0;
    transform: translateX(-14px);
    pointer-events: none;
    transition:
      opacity 160ms ease,
      transform 160ms ease;
  }

  .filters-open .filters {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .filters h3 {
    margin: 0 0 8px 0;
    font-size: 13px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.12);
  }

  .filter-group {
    display: grid;
    gap: 5px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--muted);
  }

  .filter-group label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .info h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .info-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.12);
  }

  .info-heading > div:first-child {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .info-heading-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 2px;
    border: 1px solid rgba(157, 169, 160, 0.12);
    border-radius: 10px;
    background: rgba(24, 29, 31, 0.42);
  }

  .tabs button {
    flex: 1 1 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    border-radius: 8px;
    padding: 4px 6px;
    font-size: 10px;
    line-height: 1;
    min-height: 24px;
    cursor: pointer;
  }

  .tabs button.active {
    color: var(--fg);
    background: rgba(127, 187, 179, 0.18);
  }

  .info-grid {
    display: grid;
    gap: 6px;
    font-size: 12px;
    align-content: start;
  }

  .info-grid div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(157, 169, 160, 0.08);
  }

  .warn {
    color: #e69875;
  }

  .control {
    display: grid;
    gap: 6px;
    font-size: 12px;
  }

  .panel-section {
    display: grid;
    gap: 8px;
    padding-top: 2px;
  }

  .panel-section + .panel-section {
    border-top: 1px solid rgba(157, 169, 160, 0.12);
    padding-top: 10px;
  }

  .section-heading {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
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

  .trajectory-scope {
    display: grid;
    gap: 4px;
  }

  .trajectory-scope select {
    border: 1px solid var(--border);
    background: rgba(24, 29, 31, 0.74);
    color: var(--fg);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 11px;
  }

  .operator-badge {
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(127, 187, 179, 0.12);
    border: 1px solid rgba(127, 187, 179, 0.18);
  }

  .selected-anomaly {
    color: #e67e80;
    background: rgba(230, 126, 128, 0.12);
    border-color: rgba(230, 126, 128, 0.18);
  }

  .hover-tooltip {
    position: absolute;
    z-index: 8;
    pointer-events: none;
    min-width: 180px;
    padding: 10px 12px;
    border-radius: 12px;
    display: grid;
    gap: 4px;
    font-size: 12px;
    animation: tooltip-in 120ms ease;
  }

  .hover-tooltip span {
    color: var(--muted);
  }

  @keyframes panel-slide {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes tooltip-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 980px) {
    .overlay,
    .controls,
    .info {
      width: min(92vw, 560px);
    }

    .overlay {
      left: 50%;
      transform: translateX(-50%);
      top: 12px;
    }

    .controls {
      left: 50%;
      transform: translateX(-50%);
      bottom: 12px;
    }

    .info {
      right: 12px;
      top: 190px;
    }

    .filters-shell {
      left: 12px;
      top: 200px;
      bottom: 12px;
    }
  }

  @media (max-width: 640px) {
    .overlay {
      border-radius: 12px;
      padding: 12px;
    }

    .overlay-header {
      flex-direction: column;
    }

    .overlay-header-main {
      width: 100%;
      align-items: flex-start;
    }

    .actions {
      width: 100%;
      grid-template-columns: 1fr;
    }

    .actions .btn {
      flex: 1;
    }

    .controls {
      width: calc(100vw - 16px);
      left: 8px;
      transform: none;
      bottom: 8px;
      border-radius: 12px;
    }

    .info {
      width: calc(100vw - 16px);
      left: 8px;
      right: 8px;
      border-radius: 12px;
    }

    .info {
      top: auto;
      bottom: 210px;
      max-height: 320px;
      overflow: auto;
    }
    .filters-shell {
      left: 8px;
      bottom: 8px;
      z-index: 5;
      top: auto;
      transform: none;
    }

    .filters {
      width: min(240px, 82vw);
    }
  }

  @media (min-width: 5000px), (min-height: 3000px) {
    .overlay {
      top: 36px;
      left: 36px;
      padding: 24px 28px;
      border-radius: 24px;
      width: min(860px, 42vw);
      gap: 18px;
    }

    .overlay h2 {
      font-size: 38px;
    }

    .overlay .eyebrow {
      font-size: 20px;
    }

    .controls {
      bottom: 36px;
      left: 36px;
      width: min(420px, 26vw);
      padding: 18px;
      border-radius: 22px;
      gap: 16px;
    }

    .controls-minimized {
      padding: 14px 16px;
    }

    .controls-header,
    .control-header,
    .panel-section {
      gap: 12px;
    }

    .control,
    .filter-group,
    .trajectory-scope select,
    .info-grid,
    .hover-tooltip {
      font-size: 18px;
    }

    .section-heading,
    .filters h3 {
      font-size: 18px;
    }

    .filters-shell {
      top: calc(50% + 88px);
      gap: 16px;
    }

    .filters-toggle {
      border-radius: 0 16px 16px 0;
      padding: 14px 18px;
      font-size: 18px;
    }

    .filters {
      width: 320px;
      padding: 18px;
      border-radius: 18px;
      margin-left: 12px;
    }

    .info {
      top: 36px;
      right: 36px;
      width: min(520px, 28vw);
      padding: 22px;
      border-radius: 22px;
      gap: 12px;
      max-height: calc(100vh - var(--classification-bar-height) - 72px);
    }

    .info-minimized {
      width: min(340px, 22vw);
    }

    .info h3 {
      font-size: 24px;
    }

    .tabs {
      border-radius: 14px;
      padding: 4px;
      gap: 6px;
    }

    .tabs button {
      min-height: 34px;
      font-size: 15px;
      padding: 7px 10px;
      border-radius: 10px;
    }

    .info-grid div {
      gap: 18px;
      padding-bottom: 8px;
    }

    .operator-badge {
      font-size: 14px;
      padding: 6px 10px;
    }

    .hover-tooltip {
      min-width: 260px;
      padding: 14px 16px;
      border-radius: 16px;
    }
  }
</style>
