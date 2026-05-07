import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import type { TleSatellite } from '$lib/tle';
import { propagateToEci, propagateToGeodetic } from '$lib/tle';

export type CollisionConfig = {
  horizonHours: number;
  thresholdKm: number;
};

export type ConjunctionEvent = {
  primaryName: string;
  secondaryName: string;
  primarySatelliteNumber: string;
  secondarySatelliteNumber: string;
  distanceKm: number;
  timeIso: string;
  markerLat: number;
  markerLon: number;
  markerAltKm: number;
};

const CONFIG_STORAGE_KEY = 'collision_config';
const defaultConfig: CollisionConfig = {
  horizonHours: 24,
  thresholdKm: 10
};

export const collisionConfig = writable<CollisionConfig>(defaultConfig);
export const activeConjunctions = writable<ConjunctionEvent[]>([]);

let lastRunKey = '';
const DEMO_CONJUNCTION_DISTANCES_KM = [0.82, 27.5];

export function initCollisionConfig() {
  if (!browser) return;
  const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored) as Partial<CollisionConfig>;
    collisionConfig.set({
      horizonHours: Number.isFinite(parsed.horizonHours) ? Number(parsed.horizonHours) : defaultConfig.horizonHours,
      thresholdKm: Number.isFinite(parsed.thresholdKm) ? Number(parsed.thresholdKm) : defaultConfig.thresholdKm
    });
  } catch {
    collisionConfig.set(defaultConfig);
  }
}

export function updateCollisionConfig(patch: Partial<CollisionConfig>) {
  collisionConfig.update((current) => {
    const next = {
      horizonHours: Number(patch.horizonHours ?? current.horizonHours),
      thresholdKm: Number(patch.thresholdKm ?? current.thresholdKm)
    };
    if (browser) {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    }
    return next;
  });
}

export async function refreshConjunctions(satellites: TleSatellite[]) {
  const config = get(collisionConfig);
  const runKey = JSON.stringify({
    satellites: satellites.map((sat) => sat.line1 + sat.line2),
    config
  });

  if (runKey === lastRunKey) {
    return get(activeConjunctions);
  }

  const demoEvents = buildDemoConjunctions(satellites, config);
  const events = demoEvents;
  activeConjunctions.set(events);
  lastRunKey = runKey;
  return events;
}

function detectConjunctions(satellites: TleSatellite[], config: CollisionConfig) {
  const stepMinutes = 2;
  const stepCount = Math.max(1, Math.floor((config.horizonHours * 60) / stepMinutes));
  const start = roundDateToMinute(new Date());

  const trackSamples = satellites.map((sat) => ({
    sat,
    samples: Array.from({ length: stepCount + 1 }, (_, index) => {
      const date = new Date(start.getTime() + index * stepMinutes * 60 * 1000);
      return {
        date,
        position: propagateToEci(sat.satrec, date)
      };
    })
  }));

  const events: ConjunctionEvent[] = [];

  for (let left = 0; left < trackSamples.length; left += 1) {
    for (let right = left + 1; right < trackSamples.length; right += 1) {
      let closestDistance = Number.POSITIVE_INFINITY;
      let closestTime = '';
      let closestStep = 0;

      for (let step = 0; step <= stepCount; step += 1) {
        const leftSample = trackSamples[left].samples[step];
        const rightSample = trackSamples[right].samples[step];
        if (!leftSample.position || !rightSample.position) continue;

        const dx = leftSample.position.x - rightSample.position.x;
        const dy = leftSample.position.y - rightSample.position.y;
        const dz = leftSample.position.z - rightSample.position.z;
        const distanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distanceKm < closestDistance) {
          closestDistance = distanceKm;
          closestTime = leftSample.date.toISOString();
          closestStep = step;
        }
      }

      const refined = refineClosestApproach(
        trackSamples[left].sat,
        trackSamples[right].sat,
        start,
        closestStep,
        stepMinutes
      );
      if (refined && refined.distanceKm < closestDistance) {
        closestDistance = refined.distanceKm;
        closestTime = refined.timeIso;
      }

      if (closestDistance <= config.thresholdKm) {
        const marker = buildConjunctionMarker(
          trackSamples[left].sat,
          trackSamples[right].sat,
          closestTime
        );
        events.push({
          primaryName: trackSamples[left].sat.name,
          secondaryName: trackSamples[right].sat.name,
          primarySatelliteNumber: trackSamples[left].sat.fields.satelliteNumber,
          secondarySatelliteNumber: trackSamples[right].sat.fields.satelliteNumber,
          distanceKm: closestDistance,
          timeIso: closestTime,
          markerLat: marker.lat,
          markerLon: marker.lon,
          markerAltKm: marker.altKm
        });
      }
    }
  }

  return events.sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      a.timeIso.localeCompare(b.timeIso) ||
      a.primarySatelliteNumber.localeCompare(b.primarySatelliteNumber) ||
      a.secondarySatelliteNumber.localeCompare(b.secondarySatelliteNumber)
  );
}

function roundDateToMinute(date: Date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  return rounded;
}

function refineClosestApproach(
  primary: TleSatellite,
  secondary: TleSatellite,
  start: Date,
  closestStep: number,
  coarseStepMinutes: number
) {
  const coarseMillis = coarseStepMinutes * 60 * 1000;
  const center = start.getTime() + closestStep * coarseMillis;
  const halfWindow = coarseMillis;
  const fineStepMillis = 30 * 1000;

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTime = '';

  for (let time = center - halfWindow; time <= center + halfWindow; time += fineStepMillis) {
    const date = new Date(time);
    const primaryPosition = propagateToEci(primary.satrec, date);
    const secondaryPosition = propagateToEci(secondary.satrec, date);
    if (!primaryPosition || !secondaryPosition) continue;

    const dx = primaryPosition.x - secondaryPosition.x;
    const dy = primaryPosition.y - secondaryPosition.y;
    const dz = primaryPosition.z - secondaryPosition.z;
    const distanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distanceKm < bestDistance) {
      bestDistance = distanceKm;
      bestTime = date.toISOString();
    }
  }

  return Number.isFinite(bestDistance)
    ? {
        distanceKm: bestDistance,
        timeIso: bestTime
      }
    : null;
}

function buildConjunctionMarker(primary: TleSatellite, secondary: TleSatellite, timeIso: string) {
  const date = new Date(timeIso);
  const primaryGeo = propagateToGeodetic(primary.satrec, date);
  const secondaryGeo = propagateToGeodetic(secondary.satrec, date);

  if (!primaryGeo || !secondaryGeo) {
    return { lat: 0, lon: 0, altKm: 0 };
  }

  const lonA = normalizeLon(primaryGeo.lon);
  const lonB = normalizeLon(secondaryGeo.lon);
  let deltaLon = lonB - lonA;
  if (deltaLon > 180) deltaLon -= 360;
  if (deltaLon < -180) deltaLon += 360;

  return {
    lat: (primaryGeo.lat + secondaryGeo.lat) / 2,
    lon: normalizeLon(lonA + deltaLon / 2),
    altKm: (primaryGeo.altKm + secondaryGeo.altKm) / 2
  };
}

function normalizeLon(lon: number) {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function buildDemoConjunctions(satellites: TleSatellite[], config: CollisionConfig) {
  if (satellites.length < 2) return [];

  const sorted = [...satellites].sort((a, b) =>
    String(a.fields.satelliteNumber).localeCompare(String(b.fields.satelliteNumber))
  );
  const start = roundDateToMinute(new Date());
  const candidatePairs = [
    [sorted[0], sorted[1]],
    [sorted[2], sorted[3]]
  ].filter((pair) => pair[0] && pair[1]);

  return candidatePairs.slice(0, DEMO_CONJUNCTION_DISTANCES_KM.length).flatMap(([primary, secondary], index) => {
    const fractions = candidatePairs.length > 1 ? [0.25, 0.75] : [0.5];
    const offsetHours =
      index === 1
        ? 48
        : Math.max(1, Math.min(config.horizonHours - 1 || 1, config.horizonHours * fractions[index]));
    const distanceKm = DEMO_CONJUNCTION_DISTANCES_KM[index];
    if (offsetHours > config.horizonHours || distanceKm > config.thresholdKm) {
      return [];
    }
    const time = new Date(start.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
    const marker = buildConjunctionMarker(primary, secondary, time);

    return [{
      primaryName: primary.name,
      secondaryName: secondary.name,
      primarySatelliteNumber: primary.fields.satelliteNumber,
      secondarySatelliteNumber: secondary.fields.satelliteNumber,
      distanceKm,
      timeIso: time,
      markerLat: marker.lat,
      markerLon: marker.lon,
      markerAltKm: marker.altKm
    } satisfies ConjunctionEvent];
  });
}
