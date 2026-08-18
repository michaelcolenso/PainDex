import type { ScoringWeights } from "./config";

export interface ScoringInput {
  volume: number | null;
  kd: number | null;
  postCount: number;
  avgIntent: number | null;
  velocity30d: number | null;
}

export interface OpportunityScoreFactors {
  demand: number;
  ease: number;
  pain: number;
  intent: number;
  momentum: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeOpportunityScoreFactors(input: ScoringInput, weights: ScoringWeights): OpportunityScoreFactors {
  const volume = input.volume ?? 0;
  const kd = input.kd ?? 50; // neutral midpoint when difficulty is unknown
  const avgIntent = input.avgIntent ?? 0;
  const velocity = input.velocity30d ?? 1;

  return {
    demand: Math.log10(volume + 1) * weights.demandMultiplier,
    ease: (100 - kd) * weights.easeMultiplier,
    pain: Math.min(input.postCount, weights.painCap) * weights.painMultiplier,
    intent: avgIntent * weights.intentMultiplier,
    momentum: clamp((velocity - 1) * weights.momentumMultiplier, weights.momentumMin, weights.momentumMax),
  };
}

// opportunity_score = demand + ease + pain + intent + momentum, per Build Spec §7.
export function computeOpportunityScore(input: ScoringInput, weights: ScoringWeights): number {
  const factors = computeOpportunityScoreFactors(input, weights);
  return factors.demand + factors.ease + factors.pain + factors.intent + factors.momentum;
}
