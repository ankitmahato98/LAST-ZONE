/**
 * Hitscan (instant) hit detection.
 *
 * Pure math over plain `{x, y, z}` objects - no three.js, no scene graph - so it
 * can be unit tested and reused later for projectiles (which only differ in that
 * they move between steps) or for bot line-of-sight checks.
 *
 * World geometry is queried through the existing `Collider`:
 *   `collider.pointBlocked(x, y, z)` answers "is this point inside solid geometry"
 * for terrain, oriented boxes and cylinders alike, so a marched ray plus a short
 * binary refinement finds the exact surface without duplicating collision code.
 */

const EPSILON = 1e-6;

/** Ray vs. sphere. Returns the nearest positive distance, or -1. */
export function raySphere(origin, direction, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;

  const a = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
  if (a < EPSILON) return -1;

  const b = 2 * (ox * direction.x + oy * direction.y + oz * direction.z);
  const c = ox * ox + oy * oy + oz * oz - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;

  const sqrt = Math.sqrt(discriminant);
  const t1 = (-b - sqrt) / (2 * a);
  if (t1 >= 0) return t1;
  const t2 = (-b + sqrt) / (2 * a);
  return t2 >= 0 ? t2 : -1;
}

/**
 * Ray vs. vertical cylinder (an actor hitbox), limited to [minY, maxY].
 * Returns the nearest positive distance, or -1.
 */
export function rayCylinder(origin, direction, cylinder) {
  const { x, z, radius, minY, maxY } = cylinder;
  const ox = origin.x - x;
  const oz = origin.z - z;

  const a = direction.x * direction.x + direction.z * direction.z;
  const b = 2 * (ox * direction.x + oz * direction.z);
  const c = ox * ox + oz * oz - radius * radius;

  const candidates = [];

  if (a < EPSILON) {
    // Travelling straight up/down: only a hit if we already overlap the footprint.
    if (c <= 0) candidates.push(0);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return -1;
    const sqrt = Math.sqrt(discriminant);
    candidates.push((-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a));
  }

  for (const t of candidates) {
    if (t < 0) continue;
    const y = origin.y + direction.y * t;
    if (y < minY || y > maxY) continue;
    return t;
  }

  // No side hit: the ray may start inside the cylinder's vertical span.
  if (c <= 0 && direction.y !== 0) {
    const t = ((direction.y > 0 ? minY : maxY) - origin.y) / direction.y;
    if (t >= 0) return t;
  }

  return -1;
}

/** Ray vs. axis-aligned box. Returns the nearest positive distance, or -1. */
export function rayBox(origin, direction, box, maxDistance = Infinity) {
  const min = box.min ?? { x: -box.hx, y: -box.hy, z: -box.hz };
  const max = box.max ?? { x: box.hx, y: box.hy, z: box.hz };

  let tMin = 0;
  let tMax = maxDistance;

  for (const axis of ['x', 'y', 'z']) {
    const d = direction[axis];
    const o = origin[axis];
    if (Math.abs(d) < EPSILON) {
      if (o < min[axis] || o > max[axis]) return -1;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min[axis] - o) * inv;
    let t2 = (max[axis] - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return -1;
  }

  return tMin;
}

/**
 * First solid point along a ray: walks the ray in `step` increments and then
 * bisects the boundary crossing for a precise surface point.
 *
 * @returns {{hit:boolean, distance:number, point:{x,y,z}}}
 */
export function rayWorld(origin, direction, maxDistance, collider, step = 0.5) {
  if (!collider) return { hit: false, distance: maxDistance, point: pointAt(origin, direction, maxDistance) };

  const startInside = collider.pointBlocked(origin.x, origin.y, origin.z, 0);
  if (startInside) {
    return { hit: true, distance: 0, point: { x: origin.x, y: origin.y, z: origin.z } };
  }

  let previous = 0;
  for (let t = step; t <= maxDistance; t += step) {
    const x = origin.x + direction.x * t;
    const y = origin.y + direction.y * t;
    const z = origin.z + direction.z * t;
    if (!collider.pointBlocked(x, y, z, 0)) {
      previous = t;
      continue;
    }

    // Bisect between the last free sample and this blocked one.
    let lo = previous;
    let hi = t;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) * 0.5;
      if (collider.pointBlocked(
        origin.x + direction.x * mid,
        origin.y + direction.y * mid,
        origin.z + direction.z * mid,
        0,
      )) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return { hit: true, distance: hi, point: pointAt(origin, direction, hi) };
  }

  return { hit: false, distance: maxDistance, point: pointAt(origin, direction, maxDistance) };
}

/**
 * Nearest actor hit along a ray.
 *
 * @param {Array<import('./Damageable.js').Damageable>} actors
 * @param {object} [options]
 * @param {string} [options.ignoreId] shooter id, so you cannot shoot yourself
 * @param {number} [options.maxDistance]
 */
export function rayActors(origin, direction, actors, { ignoreId = null, maxDistance = Infinity } = {}) {
  let best = null;
  let bestDistance = maxDistance;

  for (const actor of actors) {
    if (!actor.alive) continue;
    if (ignoreId && actor.id === ignoreId) continue;

    const distance = rayCylinder(origin, direction, {
      x: actor.position.x,
      z: actor.position.z,
      radius: actor.radius,
      minY: actor.position.y,
      maxY: actor.position.y + actor.height,
    });

    if (distance < 0 || distance > bestDistance) continue;
    bestDistance = distance;
    best = {
      actor,
      distance,
      point: pointAt(origin, direction, distance),
    };
  }

  return best ?? { actor: null, distance: maxDistance, point: pointAt(origin, direction, maxDistance) };
}

/**
 * Combined world + actor trace. Whatever is closest wins, so cover actually
 * works: an actor behind a wall is not hit.
 *
 * @returns {{hit:boolean, distance:number, point:object, normal:object|null,
 *            actor:import('./Damageable.js').Damageable|null, surface:'world'|'actor'|null}}
 */
export function traceShot(
  origin,
  direction,
  { collider = null, actors = [], ignoreId = null, maxDistance = 200, step = 0.5 } = {},
) {
  const world = rayWorld(origin, direction, maxDistance, collider, step);
  const actorHit = rayActors(origin, direction, actors, {
    ignoreId,
    maxDistance: world.hit ? world.distance : maxDistance,
  });

  if (actorHit.actor) {
    return {
      hit: true,
      distance: actorHit.distance,
      point: actorHit.point,
      normal: null,
      actor: actorHit.actor,
      surface: 'actor',
    };
  }

  if (world.hit) {
    return {
      hit: true,
      distance: world.distance,
      point: world.point,
      normal: surfaceNormal(world.point, collider),
      actor: null,
      surface: 'world',
    };
  }

  return {
    hit: false,
    distance: maxDistance,
    point: pointAt(origin, direction, maxDistance),
    normal: null,
    actor: null,
    surface: null,
  };
}

/**
 * Outward surface normal at an impact point.
 *
 * Derived from the "is this point solid" field by central differences, so it
 * works for terrain, oriented boxes and cylinders without any per-shape special
 * casing. The gradient of that field points *into* the solid, so the result is
 * negated: the normal always faces the shooter, which is what decals, sparks and
 * ricochets need.
 */
export function surfaceNormal(point, collider, epsilon = 0.06, out = { x: 0, y: 1, z: 0 }) {
  if (!collider?.pointBlocked) return out;

  const gx = (blocked(collider, point.x + epsilon, point.y, point.z) ? 1 : 0)
    - (blocked(collider, point.x - epsilon, point.y, point.z) ? 1 : 0);
  const gy = (blocked(collider, point.x, point.y + epsilon, point.z) ? 1 : 0)
    - (blocked(collider, point.x, point.y - epsilon, point.z) ? 1 : 0);
  const gz = (blocked(collider, point.x, point.y, point.z + epsilon) ? 1 : 0)
    - (blocked(collider, point.x, point.y, point.z - epsilon) ? 1 : 0);

  const length = Math.hypot(gx, gy, gz);
  if (length < EPSILON) {
    // No gradient (deep inside a solid): the best guess is that we hit a floor.
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }

  // Outward = opposite the solid-gradient.
  out.x = -gx / length;
  out.y = -gy / length;
  out.z = -gz / length;
  return out;
}

export function pointAt(origin, direction, distance) {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

/** Applies a random cone spread to a direction (in place on `out`). */
export function applySpread(direction, spread, random, out = { x: 0, y: 0, z: 0 }) {
  if (!(spread > 0)) {
    out.x = direction.x;
    out.y = direction.y;
    out.z = direction.z;
    return out;
  }

  // Build an orthonormal basis around the direction, then rotate within the cone.
  const up = Math.abs(direction.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(direction, up));
  const trueUp = cross(right, direction);

  const angle = random.next() * Math.PI * 2;
  const radius = Math.sqrt(random.next()) * spread;
  const offsetX = Math.cos(angle) * radius;
  const offsetY = Math.sin(angle) * radius;

  out.x = direction.x + right.x * offsetX + trueUp.x * offsetY;
  out.y = direction.y + right.y * offsetX + trueUp.y * offsetY;
  out.z = direction.z + right.z * offsetX + trueUp.z * offsetY;
  return normalize(out);
}

function blocked(collider, x, y, z) {
  return collider.pointBlocked(x, y, z, 0);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= length;
  v.y /= length;
  v.z /= length;
  return v;
}
