import { prisma } from "../../services/prisma";
import { HttpError } from "../../utils/httpError";
import type { GeofenceZonePayload } from "./geofence.schemas";

/**
 * Geofencing — a wholly new feature, not a port. main.py's
 * CompliancePolicyPayload/COMPLIANCE_FIELDS have no location-zone concept
 * at all; this module and its Compliance condition field (geofenceZoneId,
 * see complianceFields.ts) are a disclosed addition, requested to build on
 * the location telemetry (`DeviceInsightModal.vue`'s per-device history,
 * `syncDeviceLocations`'s fleet-wide latest-position cache) this app
 * already gathers via Applivery's UEM Locations API.
 *
 * A zone is a circle or polygon, drawn on the Playground map
 * (PlaygroundMapView.vue) and saved here as a reusable asset that a
 * Compliance Policy condition can reference by id. The actual "is this
 * device inside/outside" math lives in this file (isPointInZone) so both
 * the evaluator (complianceEvaluate.ts) and any future caller share one
 * implementation.
 *
 * Deliberately no geospatial DB indexing (PostGIS, a spatial index, etc.):
 * a point-in-circle/point-in-polygon check is O(vertices) and runs
 * in-process, no I/O -- even at "hundreds of thousands of devices" scale,
 * checking every scoped device against every zone referenced by an enabled
 * policy is a sub-second in-memory pass. The genuine scaling bottleneck for
 * this feature isn't the geometry math, it's keeping each device's
 * *position* fresh without exceeding Applivery's API budget -- see
 * locationsRefresh.service.ts for how that's handled.
 */

export interface GeofenceZoneGeometry {
  // circle
  center?: { lat: number; lng: number };
  radiusMeters?: number;
  // polygon
  points?: Array<{ lat: number; lng: number }>;
}

export interface GeofenceZoneLike {
  shape: string;
  geometry: GeofenceZoneGeometry;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two lat/lng points, in meters (haversine formula). */
export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Standard even-odd-rule ray-casting point-in-polygon test, treating
 * lat/lng as planar x/y. An accepted approximation for geofencing at the
 * campus/city/country scale this feature targets -- not great-circle-exact
 * for a polygon spanning thousands of km, which is well outside any real
 * "geofence a site/region" use case.
 */
export function pointInPolygon(point: { lat: number; lng: number }, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True if `point` falls inside `zone` (circle or polygon). Unknown/malformed shapes are conservatively "not inside". */
export function isPointInZone(point: { lat: number; lng: number }, zone: GeofenceZoneLike): boolean {
  if (zone.shape === "circle") {
    const { center, radiusMeters } = zone.geometry;
    if (!center || typeof radiusMeters !== "number") return false;
    return haversineDistanceMeters(point, center) <= radiusMeters;
  }
  if (zone.shape === "polygon") {
    const ring = zone.geometry.points;
    if (!Array.isArray(ring) || ring.length < 3) return false;
    return pointInPolygon(point, ring);
  }
  return false;
}

export async function listGeofenceZones(workspaceSlug: string) {
  return prisma.geofenceZone.findMany({ where: { workspaceSlug }, orderBy: { createdAt: "asc" } });
}

/** Loaded once per Compliance evaluation pass (mirrors AppListsContext) -- see complianceEvaluate.ts's GeoContext. */
export async function loadGeofenceZonesById(workspaceSlug: string): Promise<Map<string, GeofenceZoneLike & { id: string; name: string }>> {
  const zones = await listGeofenceZones(workspaceSlug);
  return new Map(zones.map((z) => [z.id, { id: z.id, name: z.name, shape: z.shape, geometry: z.geometry as GeofenceZoneGeometry }]));
}

export async function createGeofenceZone(workspaceSlug: string, payload: GeofenceZonePayload, createdBy: string) {
  return prisma.geofenceZone.create({
    data: {
      workspaceSlug,
      name: payload.name,
      description: payload.description ?? null,
      shape: payload.shape,
      geometry: payload.geometry as any,
      color: payload.color ?? null,
      createdBy,
    },
  });
}

export async function updateGeofenceZone(workspaceSlug: string, zoneId: string, payload: GeofenceZonePayload) {
  const existing = await prisma.geofenceZone.findFirst({ where: { id: zoneId, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Geofence zone not found");
  return prisma.geofenceZone.update({
    where: { id: zoneId },
    data: {
      name: payload.name,
      description: payload.description ?? null,
      shape: payload.shape,
      geometry: payload.geometry as any,
      color: payload.color ?? null,
    },
  });
}

export async function deleteGeofenceZone(workspaceSlug: string, zoneId: string) {
  const existing = await prisma.geofenceZone.findFirst({ where: { id: zoneId, workspaceSlug } });
  if (!existing) throw new HttpError(404, "Geofence zone not found");
  await prisma.geofenceZone.delete({ where: { id: zoneId } });
  return { deleted: true };
}

/**
 * Every device covered by at least one enabled policy with a
 * geofenceZoneId condition -- mirrors appListScopedDeviceIds
 * (installedApps.service.ts) exactly, and exists for the same reason:
 * the location refresher (locationsRefresh.service.ts) must only spend its
 * Applivery API budget on devices some policy actually cares about, never
 * the whole fleet by default.
 */
export function geofenceScopedDeviceIds(
  devices: Array<{ id: string; deviceAudiences?: Array<{ id: string }> }>,
  policies: Array<{ enabled: boolean; conditions: any[]; targetDeviceAudienceId?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const policy of policies) {
    if (!policy.enabled) continue;
    if (!(policy.conditions ?? []).some((c) => c?.field === "geofenceZoneId")) continue;
    if (policy.targetDeviceAudienceId) {
      for (const d of devices) {
        if ((d.deviceAudiences ?? []).some((a) => String(a.id) === String(policy.targetDeviceAudienceId))) ids.add(d.id);
      }
    } else {
      for (const d of devices) ids.add(d.id);
    }
  }
  return ids;
}
