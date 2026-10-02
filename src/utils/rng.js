/**
 * Deterministic pseudo random numbers.
 *
 * The world is generated procedurally, so every run (and every automated test)
 * must produce the exact same map for a given seed.
 */

/** Turn any string/number into a stable 32 bit unsigned integer seed. */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? '');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 - tiny, fast, good enough for world generation and gameplay rolls. */
export function createRandom(seed = 1) {
  let state = hashSeed(seed) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Random {
  constructor(seed = 1) {
    this.next = createRandom(seed);
  }

  /** Uniform float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  chance(probability) {
    return this.next() < probability;
  }

  /** Unit vector in the XZ plane (useful for scattering props). */
  directionXZ(out) {
    const angle = this.next() * Math.PI * 2;
    return out.set(Math.cos(angle), 0, Math.sin(angle));
  }
}
