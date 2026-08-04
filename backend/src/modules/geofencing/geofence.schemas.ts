import { z } from "zod";

/**
 * Zod schemas for Geofence Zones — a disclosed new feature, no main.py
 * precedent (see geofence.service.ts's file-header comment for the full
 * rationale). Mirrors the shape/validation-strictness style of
 * appLists.schemas.ts / compliance.schemas.ts.
 */

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const circleGeometrySchema = z.object({
  center: latLngSchema,
  // 2,000km cap -- generous enough for any real "zone" use case (a country
  // is the practical ceiling) while catching a clearly-malformed payload
  // (e.g. degrees accidentally sent as meters).
  radiusMeters: z.number().positive().max(2_000_000),
});

const polygonGeometrySchema = z.object({
  // A closed ring is assumed -- the drawing UI always sends the ring
  // without repeating the first point as the last; pointInPolygon's
  // ray-casting handles an implicitly-closed ring correctly either way.
  points: z.array(latLngSchema).min(3).max(500),
});

export const geofenceZoneSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("circle"),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    geometry: circleGeometrySchema,
    color: z.string().max(20).nullable().optional(),
  }),
  z.object({
    shape: z.literal("polygon"),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    geometry: polygonGeometrySchema,
    color: z.string().max(20).nullable().optional(),
  }),
]);
export type GeofenceZonePayload = z.infer<typeof geofenceZoneSchema>;

export const locationRefreshBudgetSchema = z.object({
  budgetPerHour: z.number().int(),
});
