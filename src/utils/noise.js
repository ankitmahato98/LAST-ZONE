/**
 * Deterministic 2D value noise + fractal brownian motion.
 *
 * Used by world/Terrain.js to build the height field. Height is a *pure
 * function* of (x, z), which means the simulation can sample ground height
 * analytically instead of raycasting the terrain mesh every physics step.
 */

/** Integer hash -> [0, 1). */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic fade curve - smoother than smoothstep, gives C2 continuous noise. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class ValueNoise2D {
  constructor(seed = 1) {
    this.seed = seed | 0;
  }

  /** Single octave of lattice-interpolated value noise, output roughly in [-1, 1]. */
  noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);

    const n00 = hash2(x0, y0, this.seed);
    const n10 = hash2(x0 + 1, y0, this.seed);
    const n01 = hash2(x0, y0 + 1, this.seed);
    const n11 = hash2(x0 + 1, y0 + 1, this.seed);

    const top = n00 + (n10 - n00) * fx;
    const bottom = n01 + (n11 - n01) * fx;
    const value = top + (bottom - top) * fy;

    return value * 2 - 1;
  }

  /** Fractal sum of octaves. `lacunarity` = frequency step, `gain` = amplitude step. */
  fbm(x, y, { octaves = 4, lacunarity = 2.0, gain = 0.5, frequency = 1 } = {}) {
    let amplitude = 1;
    let freq = frequency;
    let sum = 0;
    let norm = 0;

    for (let i = 0; i < octaves; i += 1) {
      sum += this.noise(x * freq, y * freq) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      freq *= lacunarity;
    }

    return norm > 0 ? sum / norm : 0;
  }
}
