import { Emitter } from '../core/events.js';
import { clamp } from '../utils/math.js';

/**
 * A pool of hit points.
 *
 * Deliberately small and dependency free: the player, training dummies and (later)
 * bots, vehicles or destructible loot chests all embed one. Damage flows *into*
 * this object and out through events, so the owner does not have to poll it.
 *
 * Events: `damaged` {amount, applied, health, meta}, `healed`, `died`, `reset`.
 */
export class Health extends Emitter {
  /**
   * @param {object} options
   * @param {number} [options.max]
   * @param {number} [options.current] spawn with less than full health
   * @param {boolean} [options.invulnerable]
   */
  constructor({ max = 100, current = null, invulnerable = false } = {}) {
    super();
    this.max = max;
    this.current = current ?? max;
    this.invulnerable = invulnerable;
    this.dead = false;
  }

  get fraction() {
    return this.max > 0 ? clamp(this.current / this.max, 0, 1) : 0;
  }

  get alive() {
    return !this.dead;
  }

  setInvulnerable(invulnerable) {
    this.invulnerable = invulnerable;
    return this;
  }

  /**
   * @param {number} amount
   * @param {object} [meta] whatever the caller wants to attach (source, weapon, point)
   * @returns {{applied:number, absorbed:number, killed:boolean, ignored:boolean}}
   */
  applyDamage(amount, meta = {}) {
    if (this.dead || this.invulnerable || !(amount > 0)) {
      return { applied: 0, absorbed: 0, killed: false, ignored: true };
    }

    const before = this.current;
    this.current = Math.max(0, this.current - amount);
    const applied = before - this.current;
    const killed = this.current === 0;
    if (killed) this.dead = true;

    this.emit('damaged', { amount, applied, health: this.current, meta });
    if (killed) this.emit('died', { meta, health: this.current });

    return { applied, absorbed: amount - applied, killed, ignored: false };
  }

  heal(amount) {
    if (this.dead || !(amount > 0)) return 0;
    const before = this.current;
    this.current = Math.min(this.max, this.current + amount);
    const healed = this.current - before;
    if (healed > 0) this.emit('healed', { amount: healed, health: this.current });
    return healed;
  }

  /** Full reset for its owner (currently used by the target-dummy rebuild). */
  reset(value = this.max) {
    this.current = clamp(value, 0, this.max);
    this.dead = this.current === 0;
    this.emit('reset', { health: this.current });
    return this.current;
  }
}
