import type { PrefilterPatterns } from "./config";

export function passesPrefilter(
  title: string,
  excerpt: string,
  patterns: PrefilterPatterns,
): boolean {
  if (title.includes("?")) return true;

  const titleRe = new RegExp(patterns.titleKeywords, "i");
  if (titleRe.test(title)) return true;

  const bodyRe = new RegExp(patterns.bodyKeywords, "i");
  if (bodyRe.test(excerpt.slice(0, 500))) return true;

  return false;
}
