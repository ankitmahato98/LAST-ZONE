/**
 * Small math helpers shared by the simulation and presentation layers.
 * Everything here is allocation free so it is safe to call from the fixed step.
 */

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent smoothing factor for exponential damping. */
export const dampFactor = (lambda, dt) => 1 - Math.exp(-lambda * dt);

export const damp = (current, target, lambda, dt) =>
  lerp(current, target, dampFactor(lambda, dt));

export const moveTowards = (current, target, maxDelta) => {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
};

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(angle) {
  const TAU = Math.PI * 2;
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest signed difference from `from` to `to`. */
export const angleDelta = (from, to) => wrapAngle(to - from);

/** Interpolate an angle along the shortest path. */
export const dampAngle = (current, target, lambda, dt) =>
  current + angleDelta(current, target) * dampFactor(lambda, dt);
