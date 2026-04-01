/**
 * Geo utilities — distance calculations and spatial filtering.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Haversine distance between two points in km.
 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Filter any array of items that have coordinates by distance from a point.
 *
 * Returns items sorted by distance (closest first), each decorated with
 * a `distanceKm` field.
 *
 * Works with any object that has `lat`/`lng` at a known path — the caller
 * provides a getter.
 *
 * @example
 * ```ts
 * const nearby = filterByDistance(places, p => p.coordinates, center, 10);
 * ```
 */
export function filterByDistance<T>(
  items: T[],
  getCoords: (item: T) => LatLng,
  center: LatLng,
  radiusKm: number,
): Array<T & { distanceKm: number }> {
  return items
    .map((item) => ({
      ...item,
      distanceKm: distanceKm(center, getCoords(item)),
    }))
    .filter((item) => item.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
