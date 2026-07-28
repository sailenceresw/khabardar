/**
 * Coarse-location handling. Khabardar never reads the device GPS — the
 * Android manifest blocks the permission outright (see app.json). Users type
 * or pick an area; we only ever keep a geohash prefix capped at 4 characters
 * (≈ ±20 km), enough for "which city/district" and useless for "which house".
 */
export const MAX_GEOHASH_PRECISION = 4;

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function isValidCoarseGeohash(value: string): boolean {
  if (value.length === 0 || value.length > MAX_GEOHASH_PRECISION) return false;
  return [...value.toLowerCase()].every((c) => BASE32.includes(c));
}

export function truncateGeohash(value: string): string {
  return value.toLowerCase().slice(0, MAX_GEOHASH_PRECISION);
}

/** Encode lat/lon to a coarse geohash. Provided for a future "pick on map"
 * flow — precision is hard-capped so a caller cannot request more. */
export function encodeCoarseGeohash(lat: number, lon: number): string {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = "";
  let bit = 0, ch = 0, even = true;

  while (hash.length < MAX_GEOHASH_PRECISION) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonMin = mid; }
      else { ch = ch << 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; }
      else { ch = ch << 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
