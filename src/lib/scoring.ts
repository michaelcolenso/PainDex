import type { ScoringWeights } from "./config";

export interface ScoringInput {
  volume: number | null;
  kd: number | null;
  postCount: number;
  avgIntent: number | null;
  velocity30d: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// opportunity_score = demand + ease + pain + intent + momentum, per Build Spec §7.
export function computeOpportunityScore(input: ScoringInput, weights: ScoringWeights): number {
  const volume = input.volume ?? 0;
  const kd = input.kd ?? 50; // neutral midpoint when difficulty is unknown
  const avgIntent = input.avgIntent ?? 0;
  const velocity = input.velocity30d ?? 1;

  const demand = Math.log10(volume + 1) * weights.demandMultiplier;
  const ease = (100 - kd) * weights.easeMultiplier;
  const pain = Math.min(input.postCount, weights.painCap) * weights.painMultiplier;
  const intent = avgIntent * weights.intentMultiplier;
  const momentum = clamp((velocity - 1) * weights.momentumMultiplier, weights.momentumMin, weights.momentumMax);

  return demand + ease + pain + intent + momentum;
}
