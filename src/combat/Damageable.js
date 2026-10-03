import { Health } from './Health.js';

/**
 * Anything combat can hit.
 *
 * A damageable couples three things that always travel together:
 *   - an id (used for ignore-self checks and hit attribution)
 *   - a live position reference (the hitbox follows the actor, no per-frame copy)
 *   - a vertical cylinder hitbox (radius + height), which is what hitscan tests
 *   - its `Health`
 *
 * The position object is kept by reference on purpose: the player's `Vector3`
 * and a dummy's `Object3D.position` both satisfy it, and the hitbox stays
 * correct without any synchronisation step.
 *
 * `hitHeightRanges` exists so a weapon can tell a head from a body without the
 * hit detection code knowing anything about character rigs.
 */
export class Damageable {
  /**
   * @param {object} options
   * @param {string} options.id
   * @param {{x:number,y:number,z:number}} options.position live reference to the
   *        actor's feet position
   * @param {Health} [options.health]
   * @param {number} [options.radius]
   * @param {number} [options.height]
   * @param {string} [options.team] 'player' | 'target' | 'neutral' | ...
   * @param {string} [options.kind] free-form label for UI/analytics
   * @param {object} [options.owner] the system/object this hitbox belongs to
   */
  constructor({
    id,
    position,
    health = new Health(),
    radius = 0.45,
    height = 1.75,
    team = 'neutral',
    kind = 'actor',
    owner = null,
  }) {
    this.id = id;
    this.position = position;
    this.health = health;
    this.radius = radius;
    this.height = height;
    this.team = team;
    this.kind = kind;
    this.owner = owner;

    /** Portion of the hitbox treated as a head (for damage multipliers). */
    this.headHeightFraction = 0.84;
    /** Set by the owner when it wants this target hidden or temporarily unhittable. */
    this.enabled = true;
  }

  get alive() {
    return this.enabled && this.health.alive;
  }

  /** Centre of the hitbox - the point used for aim helpers and hit markers. */
  get center() {
    return {
      x: this.position.x,
      y: this.position.y + this.height * 0.5,
      z: this.position.z,
    };
  }

  get headY() {
    return this.position.y + this.height * this.headHeightFraction;
  }

  isHeadshot(hitY) {
    return hitY >= this.headY;
  }

  /**
   * @param {number} amount
   * @param {object} [meta]
   * @returns {ReturnType<Health['applyDamage']>}
   */
  takeDamage(amount, meta = {}) {
    if (!this.enabled) return { applied: 0, absorbed: 0, killed: false, ignored: true };
    return this.health.applyDamage(amount, meta);
  }
}

export const createDamageable = (options) => new Damageable(options);
