import { clamp } from '../utils/math.js';

/**
 * Collision for the world's static geometry.
 *
 * The world has three kinds of solid:
 *   - the terrain, as an analytic height field (`heightSampler.heightAt`)
 *   - oriented boxes (`BoxBlocker`) for walls, crates and buildings
 *   - vertical cylinders (`CircleBlocker`) for trees, rocks and pillars
 *
 * Actors are upright capsules approximated by a circle (radius) plus a vertical
 * span (feet -> head). The collider is *stateless*: every call takes the acting
 * body's dimensions, so the player, an enemy or a dropped crate can all use the
 * same instance.
 *
 * `resolveHorizontal` pushes a position out of solids; the controller is
 * responsible for the vertical axis (gravity, stepping, ground snapping), which
 * keeps the movement code readable and easy to extend (slopes, ladders, ...).
 */

export class BoxBlocker {
  /**
   * @param {object} options
   * @param {{x:number,y:number,z:number}} options.center world-space centre
   * @param {{x:number,y:number,z:number}} options.size   full size
   * @param {number} [options.yaw] rotation around Y in radians
   * @param {boolean} [options.walkable] true when actors may stand on top
   */
  constructor({ center, size, yaw = 0, walkable = false, name = 'box' }) {
    this.name = name;
    this.center = { ...center };
    this.half = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.walkable = walkable;
  }

  get topY() {
    return this.center.y + this.half.y;
  }

  get bottomY() {
    return this.center.y - this.half.y;
  }

  worldToLocal(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return {
      x: dx * this.cos + dz * this.sin,
      z: -dx * this.sin + dz * this.cos,
    };
  }

  localToWorld(lx, lz) {
    return {
      x: this.center.x + lx * this.cos - lz * this.sin,
      z: this.center.z + lx * this.sin + lz * this.cos,
    };
  }

  /** Distance from a point to the box footprint, and the push-out normal. */
  circlePush(x, z, radius, out) {
    const local = this.worldToLocal(x, z);
    const hx = this.half.x;
    const hz = this.half.z;
    const closestX = clamp(local.x, -hx, hx);
    const closestZ = clamp(local.z, -hz, hz);
    let nx = local.x - closestX;
    let nz = local.z - closestZ;
    const distSq = nx * nx + nz * nz;

    if (distSq > radius * radius) {
      out.pushed = false;
      return out;
    }

    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      const push = radius + SKIN - dist;
      out.nx = nx / dist;
      out.nz = nz / dist;
      out.push = push;
    } else {
      // Point is inside the box: escape through the shallowest face.
      const penX = hx - Math.abs(local.x);
      const penZ = hz - Math.abs(local.z);
      if (penX < penZ) {
        out.nx = Math.sign(local.x) || 1;
        out.nz = 0;
        out.push = penX + radius + SKIN;
      } else {
        out.nx = 0;
        out.nz = Math.sign(local.z) || 1;
        out.push = penZ + radius + SKIN;
      }
    }

    out.pushed = true;
    return out;
  }

  /** World-space push-out for a circle at (x, z) with the given radius. */
  pushOut(position, radius, result) {
    const local = this.circlePush(position.x, position.z, radius, result);
    if (!local.pushed) return false;
    position.x += (local.nx * this.cos - local.nz * this.sin) * local.push;
    position.z += (local.nx * this.sin + local.nz * this.cos) * local.push;
    return true;
  }

  /** True when the circle footprint covers (part of) the box - used for spawns. */
  overlapsFootprint(x, z, radius) {
    const local = this.worldToLocal(x, z);
    const dx = Math.max(Math.abs(local.x) - this.half.x, 0);
    const dz = Math.max(Math.abs(local.z) - this.half.z, 0);
    return dx * dx + dz * dz < radius * radius;
  }

  /** Circle-vs-box overlap in 3D, treating the actor as a vertical segment. */
  heightRange() {
    return { min: this.bottomY, max: this.topY };
  }
}

export class CircleBlocker {
  constructor({ x, z, radius, height, y = 0, name = 'cylinder' }) {
    this.name = name;
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.bottomY = y;
    this.topY = y + height;
  }

  pushOut(position, radius, result) {
    const dx = position.x - this.x;
    const dz = position.z - this.z;
    const minDist = radius + this.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist) {
      result.pushed = false;
      return false;
    }
    const dist = Math.sqrt(distSq) || 1e-6;
    const push = minDist + SKIN - dist;
    result.nx = dx / dist;
    result.nz = dz / dist;
    result.push = push;
    result.pushed = true;
    position.x += result.nx * push;
    position.z += result.nz * push;
    return true;
  }

  overlapsFootprint(x, z, radius) {
    const dx = x - this.x;
    const dz = z - this.z;
    const minDist = radius + this.radius;
    return dx * dx + dz * dz < minDist * minDist;
  }

  heightRange() {
    return { min: this.bottomY, max: this.topY };
  }
}

/**
 * Push bodies out with a hair of extra clearance. Floating point error would
 * otherwise leave a resting body exactly on the surface, where "am I inside
 * geometry?" checks become a coin flip.
 */
const SKIN = 1e-3;

const SCRATCH = { pushed: false, nx: 0, nz: 0, push: 0 };

export class Collider {
  /**
   * @param {object} options
   * @param {{heightAt(x:number,z:number):number}} options.heightSampler
   * @param {Array<BoxBlocker>} [options.boxes]
   * @param {Array<CircleBlocker>} [options.cylinders]
   * @param {number} [options.worldLimit] soft circular world boundary radius
   */
  constructor({ heightSampler, boxes = [], cylinders = [], worldLimit = Infinity }) {
    this.heightSampler = heightSampler;
    this.boxes = boxes;
    this.cylinders = cylinders;
    this.worldLimit = worldLimit;
  }

  heightAt(x, z) {
    return this.heightSampler.heightAt(x, z);
  }

  /** |gradient| of the terrain - 0 is flat, 1 is a 45 degree slope. */
  slopeAt(x, z, epsilon = 0.6) {
    const hx = this.heightAt(x + epsilon, z) - this.heightAt(x - epsilon, z);
    const hz = this.heightAt(x, z + epsilon) - this.heightAt(x, z - epsilon);
    return Math.hypot(hx, hz) / (2 * epsilon);
  }

  /**
   * Highest surface under (x, z) that the actor can stand on at `feetY`.
   * Walkable box tops and the terrain are considered; any solid whose top is
   * too far above the feet is a wall rather than a floor.
   */
  groundHeightAt(x, z, feetY, body) {
    let ground = this.heightAt(x, z);
    const reach = feetY + body.stepHeight + 0.001;

    for (const box of this.boxes) {
      if (!box.walkable) continue;
      if (box.topY > reach) continue;
      if (box.overlapsFootprint(x, z, body.radius * 0.85)) {
        if (box.topY > ground) ground = box.topY;
      }
    }
    return ground;
  }

  /** Push the position out of every solid it currently overlaps. */
  resolveHorizontal(position, body, passes = 2) {
    let collided = false;
    for (let pass = 0; pass < passes; pass += 1) {
      let moved = false;
      const headY = position.y + body.height;

      for (const box of this.boxes) {
        // Floors are handled by the vertical solver.
        if (box.walkable && position.y >= box.topY - body.stepHeight) continue;
        if (headY <= box.bottomY || position.y >= box.topY) continue;
        if (box.pushOut(position, body.radius, SCRATCH)) moved = true;
      }

      for (const cylinder of this.cylinders) {
        if (headY <= cylinder.bottomY || position.y >= cylinder.topY) continue;
        if (cylinder.pushOut(position, body.radius, SCRATCH)) moved = true;
      }

      if (!moved) break;
      collided = collided || moved;
    }
    return collided;
  }

  /** True when an actor with the given dimensions could stand at (x, z, y). */
  isClear(x, z, y, body) {
    const ground = this.groundHeightAt(x, z, y, body);
    if (Math.abs(ground - y) > 0.6) return false;

    const probe = { x, y, z };
    for (const box of this.boxes) {
      if (positionInsideBox(probe, body, box)) return false;
    }
    for (const cylinder of this.cylinders) {
      if (probe.y + body.height <= cylinder.bottomY) continue;
      if (probe.y >= cylinder.topY) continue;
      if (cylinder.overlapsFootprint(x, z, body.radius)) return false;
    }
    return true;
  }
  /**
   * Point probe used by the camera: is this position inside (or too close to)
   * solid geometry? `padding` keeps the near plane out of walls.
   */
  pointBlocked(x, y, z, padding = 0.3) {
    if (this.heightAt(x, z) + padding > y) return true;

    for (const box of this.boxes) {
      if (y > box.topY + padding || y < box.bottomY - padding) continue;
      if (box.overlapsFootprint(x, z, padding)) return true;
    }

    for (const cylinder of this.cylinders) {
      if (y > cylinder.topY + padding || y < cylinder.bottomY - padding) continue;
      if (cylinder.overlapsFootprint(x, z, padding)) return true;
    }

    return false;
  }
}

function positionInsideBox(position, body, box) {
  const headY = position.y + body.height;
  if (headY <= box.bottomY || position.y >= box.topY) return false;
  return box.overlapsFootprint(position.x, position.z, body.radius);
}

export const createPushResult = () => ({ pushed: false, nx: 0, nz: 0, push: 0 });

