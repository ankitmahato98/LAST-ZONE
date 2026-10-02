/**
 * Spawn validation.
 *
 * A position is only a valid spawn if the ground is walkable, the slope is not
 * a cliff, and nothing solid is standing there. Keeping this behind a tiny
 * interface means the player controller (and later, bots or a network spawn
 * message) never has to know how the world is built.
 *
 * @typedef {object} SpawnBody
 * @property {number} radius
 * @property {number} height
 */

export class RayWorldSpawnTester {
  /**
   * Uses the world's analytic height field plus a clearance probe - no actual
   * raycasting is needed, which keeps spawns instant even during respawn.
   */
  constructor({ world, maxSlope = 0.55 }) {
    this.world = world;
    this.maxSlope = maxSlope;
    this.stats = { tested: 0, rejected: 0 };
  }

  /**
   * @param {{x:number,y:number,z:number}} position mutated in place with the
   *        ground height when the position is valid
   * @param {SpawnBody} body
   */
  test(position, body) {
    this.stats.tested += 1;

    if (!this.world.isInside(position.x, position.z)) return this._reject();
    if (!this.world.isWithinBounds(position.x, position.z)) return this._reject();

    const groundY = this.world.heightAt(position.x, position.z);
    if (this.world.slopeAt(position.x, position.z) > this.maxSlope) return this._reject();

    if (this.world.collider && !this.world.collider.isClear(position.x, position.z, groundY, body)) {
      return this._reject();
    }

    position.y = groundY;
    return true;
  }

  _reject() {
    this.stats.rejected += 1;
    return false;
  }
}

/**
 * 2D keep-out volumes (drop zones, player spawn plates, spawn protection
 * bubbles, ...). A plain circle list is enough for the current map and trivially
 * extended with rects later.
 */
export class SilhouetteSpawnTester {
  constructor({ silhouettes = [], margin = 0.5 } = {}) {
    this.silhouettes = silhouettes;
    this.margin = margin;
  }

  add(silhouette) {
    this.silhouettes.push(silhouette);
    return this;
  }

  test(position, body = { radius: 0.4 }) {
    for (const shape of this.silhouettes) {
      if (shape.disabled) continue;
      const dx = position.x - shape.x;
      const dz = position.z - shape.z;
      const limit = (shape.radius ?? 0) + this.margin + body.radius;
      if (dx * dx + dz * dz < limit * limit) return false;
    }
    return true;
  }
}
