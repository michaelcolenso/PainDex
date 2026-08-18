import { describe, expect, it } from "vitest";
import {
  isOpportunityStage,
  legacyStatusFromStage,
  stageFromLegacyStatus,
  validateTransition,
} from "../src/lib/opportunityPipeline";

describe("Opportunity Pipeline state machine", () => {
  it("allows adjacent active-stage movement and idempotent writes", () => {
    expect(validateTransition("watching", "validating")).toEqual({ ok: true, idempotent: false });
    expect(validateTransition("validating", "watching")).toEqual({ ok: true, idempotent: false });
    expect(validateTransition("pursue", "pursue")).toEqual({ ok: true, idempotent: true });
  });

  it("rejects skipping active stages", () => {
    expect(validateTransition("new", "pursue").ok).toBe(false);
    expect(validateTransition("watching", "building").ok).toBe(false);
  });

  it("allows kill/archive from non-launched active work", () => {
    expect(validateTransition("new", "killed").ok).toBe(true);
    expect(validateTransition("building", "archived").ok).toBe(true);
    expect(validateTransition("launched", "killed").ok).toBe(false);
  });

  it("requires explicit restore from terminal states", () => {
    expect(validateTransition("killed", "watching").ok).toBe(false);
    expect(validateTransition("killed", "watching", "restore").ok).toBe(true);
    expect(validateTransition("archived", "pursue", "restore").ok).toBe(false);
  });

  it("maps legacy cluster status without losing compatibility", () => {
    expect(stageFromLegacyStatus("new")).toBe("new");
    expect(stageFromLegacyStatus("watching")).toBe("watching");
    expect(stageFromLegacyStatus("pursue")).toBe("pursue");
    expect(stageFromLegacyStatus("killed")).toBe("killed");
    expect(legacyStatusFromStage("validating")).toBe("watching");
    expect(legacyStatusFromStage("building")).toBe("pursue");
    expect(legacyStatusFromStage("archived")).toBe("killed");
  });

  it("validates stage strings", () => {
    expect(isOpportunityStage("building")).toBe(true);
    expect(isOpportunityStage("done")).toBe(false);
  });
});
