-- Retire the abuseipdb/hibp/generic_rest Threat Intel provider types (see
-- threatIntel.schemas.ts's THREAT_INTEL_PROVIDER_TYPES doc comment) — an
-- audit found the Cases IOC auto-enrichment flow they fed almost never
-- fires in this product (it only scans analyst-typed note text, never the
-- structured titles the two automated case sources generate), and they had
-- no other use. VirusTotal is untouched: its file-hash lookup remains, and
-- is the intended engine for a planned separate feature (hashing installed
-- binaries to flag sideloaded/unverified software).
--
-- Deletes any already-configured rows of these types outright rather than
-- leaving them orphaned — the application layer no longer recognizes these
-- type values (validateProviderPayload would reject re-saving one), so a
-- dangling row would just be inert dead config an admin can't edit or
-- understand why it's stuck.

DELETE FROM "ThreatIntelProvider" WHERE "type" IN ('abuseipdb', 'hibp', 'generic_rest');
