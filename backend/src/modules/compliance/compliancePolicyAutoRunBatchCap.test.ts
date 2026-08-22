import { describe, expect, it } from "vitest";
import { resolveAutoRunBatchCapOnSave } from "./compliance.service";

/**
 * Regression test for the "AUTORUN SAFETY LIMITS reverts on reopen" bug:
 * `autoRunBatchCap: payload.autoRunBatchCap ?? 15` used to coerce an
 * explicit `null` ("No limit", a deliberate sentinel) back into 15 on
 * every create/update, because `??` treats `null` and `undefined`
 * identically. The fix distinguishes the two explicitly.
 */
describe("resolveAutoRunBatchCapOnSave", () => {
  it("preserves an explicit null (the 'No limit' sentinel) unchanged", () => {
    expect(resolveAutoRunBatchCapOnSave(null)).toBeNull();
  });

  it("defaults a genuinely missing value (undefined) to 15", () => {
    expect(resolveAutoRunBatchCapOnSave(undefined)).toBe(15);
  });

  it("passes through an explicit positive number unchanged", () => {
    expect(resolveAutoRunBatchCapOnSave(25)).toBe(25);
    expect(resolveAutoRunBatchCapOnSave(1)).toBe(1);
  });
});
