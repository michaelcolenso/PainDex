import { describe, expect, it } from "vitest";
import { computeOpportunityScore, type ScoringInput } from "../src/lib/scoring";
import { DEFAULT_SCORING_WEIGHTS } from "../src/lib/config";

const w = DEFAULT_SCORING_WEIGHTS;

function score(overrides: Partial<ScoringInput>): number {
  return computeOpportunityScore(
    { volume: null, kd: null, postCount: 0, avgIntent: null, velocity30d: null, ...overrides },
    w,
  );
}

describe("computeOpportunityScore", () => {
  it("returns a neutral baseline when every signal is null/zero", () => {
    // volume 0 -> demand 0; kd null -> 50 -> ease = 50 * 0.3 = 15; pain 0;
    // intent null -> 0; velocity null -> 1 -> momentum = clamp(0,...) = 0.
    expect(score({})).toBeCloseTo(15, 6);
  });

  it("treats unknown difficulty as the neutral midpoint (kd = 50)", () => {
    expect(score({ kd: null })).toBeCloseTo(score({ kd: 50 }), 6);
  });

  it("rewards higher search volume via a log10 demand term", () => {
    const low = score({ volume: 10 });
    const high = score({ volume: 10_000 });
    expect(high).toBeGreaterThan(low);
    // demand = log10(volume + 1) * 12
    expect(high - low).toBeCloseTo((Math.log10(10_001) - Math.log10(11)) * w.demandMultiplier, 6);
  });

  it("rewards lower keyword difficulty (easier = higher ease)", () => {
    expect(score({ kd: 10 })).toBeGreaterThan(score({ kd: 90 }));
  });

  it("caps the pain contribution at painCap posts", () => {
    const atCap = score({ postCount: w.painCap });
    const overCap = score({ postCount: w.painCap + 50 });
    expect(overCap).toBeCloseTo(atCap, 6);
  });

  it("scales pain linearly below the cap", () => {
    const base = score({ postCount: 0 });
    const five = score({ postCount: 5 });
    expect(five - base).toBeCloseTo(5 * w.painMultiplier, 6);
  });

  it("scales intent linearly", () => {
    const base = score({ avgIntent: 0 });
    const strong = score({ avgIntent: 5 });
    expect(strong - base).toBeCloseTo(5 * w.intentMultiplier, 6);
  });

  it("gives zero momentum at steady velocity (velocity = 1)", () => {
    expect(score({ velocity30d: 1 })).toBeCloseTo(score({ velocity30d: null }), 6);
  });

  it("clamps momentum to its configured floor and ceiling", () => {
    const surging = score({ velocity30d: 100 }); // (100-1)*10 = 990 -> clamp to max
    const collapsing = score({ velocity30d: 0 }); // (0-1)*10 = -10 -> clamp to min
    const steady = score({ velocity30d: 1 });
    expect(surging - steady).toBeCloseTo(w.momentumMax, 6);
    expect(collapsing - steady).toBeCloseTo(w.momentumMin, 6);
  });

  it("combines all five terms additively", () => {
    const input: ScoringInput = {
      volume: 1000,
      kd: 20,
      postCount: 8,
      avgIntent: 4,
      velocity30d: 2,
    };
    const demand = Math.log10(1001) * w.demandMultiplier;
    const ease = (100 - 20) * w.easeMultiplier;
    const pain = 8 * w.painMultiplier;
    const intent = 4 * w.intentMultiplier;
    const momentum = (2 - 1) * w.momentumMultiplier;
    expect(computeOpportunityScore(input, w)).toBeCloseTo(demand + ease + pain + intent + momentum, 6);
  });
});
