export const OPPORTUNITY_STAGES = [
  "new",
  "watching",
  "validating",
  "pursue",
  "building",
  "launched",
  "killed",
  "archived",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export type TransitionAction = "set" | "restore";

const ACTIVE_STAGES: OpportunityStage[] = ["new", "watching", "validating", "pursue", "building", "launched"];
const TERMINAL_STAGES = new Set<OpportunityStage>(["killed", "archived"]);

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

export function stageFromLegacyStatus(status: string): OpportunityStage {
  switch (status) {
    case "watching":
      return "watching";
    case "pursue":
      return "pursue";
    case "killed":
      return "killed";
    default:
      return "new";
  }
}

export function legacyStatusFromStage(stage: OpportunityStage): "new" | "watching" | "pursue" | "killed" {
  switch (stage) {
    case "watching":
    case "validating":
      return "watching";
    case "pursue":
    case "building":
    case "launched":
      return "pursue";
    case "killed":
    case "archived":
      return "killed";
    default:
      return "new";
  }
}

export interface TransitionResult {
  ok: boolean;
  idempotent: boolean;
  reason?: string;
}

export function validateTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  action: TransitionAction = "set",
): TransitionResult {
  if (from === to) return { ok: true, idempotent: true };

  if (TERMINAL_STAGES.has(from)) {
    if (action === "restore" && to === "watching") return { ok: true, idempotent: false };
    return { ok: false, idempotent: false, reason: "terminal opportunities require an explicit restore to watching" };
  }

  if (to === "killed" || to === "archived") {
    if (from === "launched") {
      return { ok: false, idempotent: false, reason: "launched opportunities cannot be killed or archived" };
    }
    return { ok: true, idempotent: false };
  }

  if (action === "restore") {
    return { ok: false, idempotent: false, reason: "restore is only valid from killed or archived" };
  }

  const fromIndex = ACTIVE_STAGES.indexOf(from);
  const toIndex = ACTIVE_STAGES.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return { ok: false, idempotent: false, reason: "invalid active stage" };

  if (Math.abs(toIndex - fromIndex) <= 1) return { ok: true, idempotent: false };
  return { ok: false, idempotent: false, reason: "active opportunities may only move one stage at a time" };
}
