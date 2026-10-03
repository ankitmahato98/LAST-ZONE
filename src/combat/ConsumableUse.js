import { EventBus } from '../core/events.js';
import { clamp } from '../utils/math.js';
import { ConsumableApplication } from '../loot/items/ItemData.js';

/**
 * Consumable channel.
 *
 * One "use" at a time, driven by the item's own `use` block:
 *   - `duration`      how long the channel takes (never instant full healing)
 *   - `application`   `instant` pays out when the channel completes, `gradual`
 *                     pays out evenly across the duration
 *   - `interruptOn`   which actions cancel the channel (`damage`, `fire`, `jump`)
 *
 * The item is consumed by the caller when the channel *starts*, so an
 * interrupted inhaler keeps whatever it already restored and loses the rest -
 * this is what makes healing a decision instead of a free action.
 *
 * Pure logic on a fixed timestep: no DOM, no scene graph, fully unit-testable.
 *
 * Events: `start`, `complete`, `cancel` (with a reason).
 */
export class ConsumableUse {
  constructor({ name = 'consumableUse' } = {}) {
    this.name = name;
    this.events = new EventBus();
    this.active = false;
    this.definition = null;
    this.itemId = null;
    /** Seconds left in the channel. */
    this.remaining = 0;
    this.duration = 0;
    /** Effect already paid out, so a completion can pay the exact remainder. */
    this._paidHealth = 0;
    this._paidEnergy = 0;
    /** Reusable effect payload - never allocate inside the fixed step. */
    this._effects = { health: 0, energy: 0, done: false };
  }

  on(type, handler) {
    return this.events.on(type, handler);
  }

  get progress() {
    if (!this.active || this.duration <= 0) return this.active ? 1 : 0;
    return clamp(1 - this.remaining / this.duration, 0, 1);
  }

  get isActive() {
    return this.active;
  }

  get canInterrupt() {
    return Boolean(this.active);
  }

  /**
   * @param {object} definition a registered item definition with a `use` block
   * @returns {{started:boolean, reason:string|null}}
   */
  start(definition) {
    if (this.active) return { started: false, reason: 'busy' };
    if (!definition?.use) return { started: false, reason: 'not-consumable' };

    this.active = true;
    this.definition = definition;
    this.itemId = definition.id;
    this.duration = Math.max(0.05, definition.use.duration ?? 1);
    this.remaining = this.duration;
    this._paidHealth = 0;
    this._paidEnergy = 0;
    this.events.emit('start', { itemId: definition.id, duration: this.duration });
    return { started: true, reason: null };
  }

  /**
   * Advance the channel.
   * @param {number} dt
   * @returns {{health:number, energy:number, done:boolean}|null} effect to apply
   */
  update(dt) {
    if (!this.active) return null;
    const use = this.definition.use;
    const step = Math.min(dt, this.remaining);
    this.remaining = Math.max(0, this.remaining - dt);

    const healthTotal = use.health ?? 0;
    const energyTotal = use.energy ?? 0;
    let health = 0;
    let energy = 0;
    let done = false;

    if (use.application === ConsumableApplication.GRADUAL && this.duration > 0) {
      const fraction = step / this.duration;
      health = healthTotal * fraction;
      energy = energyTotal * fraction;
      this._paidHealth += health;
      this._paidEnergy += energy;
      if (this.remaining <= 1e-6) {
        // Settle the floating point difference so the totals are exact.
        health = healthTotal - (this._paidHealth - health);
        energy = energyTotal - (this._paidEnergy - energy);
        done = true;
      }
    } else if (this.remaining <= 1e-6) {
      health = healthTotal;
      energy = energyTotal;
      done = true;
    }

    this._effects.health = health;
    this._effects.energy = energy;
    this._effects.done = done;

    if (done) {
      const finished = this.definition;
      this.active = false;
      this.definition = null;
      this.itemId = finished.id;
      this.remaining = 0;
      this.events.emit('complete', { itemId: finished.id });
    }
    return this._effects;
  }

  /**
   * Cancel the channel if the item reacts to that action.
   * @param {'damage'|'fire'|'jump'|'manual'|string} reason
   * @returns {boolean} true when the channel was cancelled
   */
  interrupt(reason) {
    if (!this.active) return false;
    const rules = this.definition?.use?.interruptOn ?? [];
    if (reason !== 'manual' && !rules.includes(reason)) return false;
    return this.cancel(reason);
  }

  cancel(reason = 'manual') {
    if (!this.active) return false;
    const itemId = this.itemId;
    this.active = false;
    this.definition = null;
    this.remaining = 0;
    this.events.emit('cancel', { itemId, reason });
    return true;
  }
}
