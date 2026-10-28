/**
 * Seeded pseudo-random numbers for the demo seed (Issue #301).
 *
 * Mulberry32: tiny, fast and identical on every runtime, so the same seed
 * always produces the same demo data. Not for anything security-related.
 */
export type Random = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  between(min: number, max: number): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Normally distributed around `mean`, clamped to `[min, max]` when given. */
  normal(mean: number, sd: number, min?: number, max?: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** A child stream, so adding draws in one module never shifts another. */
  fork(label: string): Random;
};

export const DEMO_SEED = 301;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, to turn a fork label into a seed. */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRandom(seed: number = DEMO_SEED): Random {
  const next = mulberry32(seed);
  return {
    next,
    between: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: (mean, sd, min, max) => {
      // Box-Muller; `1 - next()` keeps the logarithm finite.
      const u = 1 - next();
      const v = next();
      const value = mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
    },
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error("Cannot pick from an empty list.");
      return items[Math.floor(next() * items.length)]!;
    },
    fork: (label) => createRandom((seed ^ hashLabel(label)) >>> 0),
  };
}

/** Rounds to `digits` decimals. */
export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
