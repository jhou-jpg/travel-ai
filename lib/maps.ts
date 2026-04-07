/**
 * Google Maps Static API URL generator with editorial styling.
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
 */

const MAP_STYLES = [
  "feature:all|element:geometry.fill|color:0x2a2520",
  "feature:all|element:labels.text.fill|color:0x9a8a7c",
  "feature:all|element:labels.text.stroke|color:0x1a1714",
  "feature:water|element:geometry|color:0x1a1714",
  "feature:water|element:labels.text.fill|color:0x4a3f36",
  "feature:road|element:geometry|color:0x3a3530",
  "feature:road|element:geometry.stroke|color:0x2a2520",
  "feature:road.highway|element:geometry|color:0x4a4540",
  "feature:poi|visibility:off",
  "feature:transit|visibility:off",
].map((s) => `&style=${encodeURIComponent(s)}`).join("");

type Coord = { lat: number; lng: number };

export function staticMapUrl(options: {
  center?: Coord;
  markers: Array<Coord & { label?: string }>;
  width?: number;
  height?: number;
  zoom?: number;
  path?: boolean;
}): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  if (options.markers.length === 0) return null;

  const { width = 600, height = 800, zoom, path } = options;

  // Build markers string
  const markerStr = options.markers
    .map((m, i) => {
      const label = m.label || String(i + 1);
      return `&markers=color:0xad603f|label:${label}|${m.lat},${m.lng}`;
    })
    .join("");

  // Build path string (connects markers in order)
  let pathStr = "";
  if (path && options.markers.length >= 2) {
    const coords = options.markers.map((m) => `${m.lat},${m.lng}`).join("|");
    pathStr = `&path=color:0x8f482aff|weight:3|${coords}`;
  }

  // Center: use provided or auto-fit
  let centerZoom = "";
  if (options.center && zoom) {
    centerZoom = `&center=${options.center.lat},${options.center.lng}&zoom=${zoom}`;
  }

  return (
    `https://maps.googleapis.com/maps/api/staticmap?` +
    `size=${width}x${height}&scale=2` +
    MAP_STYLES +
    centerZoom +
    markerStr +
    pathStr +
    `&key=${key}`
  );
}

/**
 * Google Maps Embed URL for an interactive map view.
 */
export function embedMapUrl(options: {
  center: Coord;
  zoom?: number;
}): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  return (
    `https://www.google.com/maps/embed/v1/view?` +
    `key=${key}` +
    `&center=${options.center.lat},${options.center.lng}` +
    `&zoom=${options.zoom || 13}` +
    `&maptype=roadmap`
  );
}
