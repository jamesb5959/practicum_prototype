import type { ConjunctionEvent } from '$lib/conjunction';

export function findConjunctionForSatellite(events: ConjunctionEvent[], satelliteNumber: string) {
  return events.find(
    (event) =>
      event.primarySatelliteNumber === satelliteNumber || event.secondarySatelliteNumber === satelliteNumber
  );
}
