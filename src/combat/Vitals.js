import { Emitter } from '../core/events.js';
import { Health } from './Health.js';
import { EP, HEALTH } from '../config/settings.js';
import { clamp } from '../utils/math.js';

/**
 * Player vitals: HP over EP.
 *
 * LOCKED PHASE B VALUES
 *   max HP           200
 *   max EP           300
 *   1 EP             1 HP
 *   conversion rate  1 EP per second  ->  1 HP per second
 *   conversion stops when HP reaches 200, and EP can never pass 300
 *
 * EP does **not** regenerate passively: it only comes from consumables, and it
 * leaves the pool through an explicit conversion. That is also what stops EP
 * from behaving like permanent bonus maximum HP - it is a temporary buffer that
 * is spent 1:1 into a pool that is already capped at 200.
 *
 * The object is pure (no meshes, no DOM) so the numbers above are unit-testable
 * in isolation; `CombatSystem` forwards all damage into it and the HUD only
 * reads it.
 *
 * Events: `energy` {energy, delta, max}, `conversion` {active, reason}.
 */
export class Vitals extends Emitter {
  constructor({
    maxHealth = HEALTH.playerMax,
    maxEnergy = EP.max,
    hpPerEnergy = EP.hpPerEnergy,
    conversionRate = EP.conversionRate,
    health = null,
  } = {}) {
    super();
    this.maxHealth = maxHealth;
    this.maxEnergy = maxEnergy;
    /** HP gained per EP spent. */
    this.hpPerEnergy = hpPerEnergy;
    /** EP spent per second while converting. */
    this.conversionRate = conversionRate;

    this.health = health ?? new Health({ max: maxHealth });
    this.energy = 0;
    /** Conversion is explicit - it is not a passive regen. */
    this.converting = false;
    this.stopReason = null;
  }

  // ------------------------------------------------------------- accessors --

  get hp() {
    return this.health.current;
  }

  get maxHp() {
    return this.health.max;
  }

  get hpFraction() {
    return this.health.fraction;
  }

  get energyFraction() {
    return this.maxEnergy > 0 ? clamp(this.energy / this.maxEnergy, 0, 1) : 0;
  }

  get dead() {
    return this.health.dead;
  }

  get canConvert() {
    return !this.dead && this.energy > 0 && this.hp < this.maxHealth;
  }

  /** 1:1 with HP, so it is the amount of HP this EP pool could still restore. */
  get convertibleHealth() {
    return Math.min(this.energy * this.hpPerEnergy, this.maxHealth - this.hp);
  }

  // ------------------------------------------------------------------- EP ----

  /**
   * Add EP from a consumable. The pool is hard-capped at `maxEnergy`.
   * @returns {number} the amount actually stored
   */
  addEnergy(amount) {
    if (!(amount > 0) || this.dead) return 0;
    const before = this.energy;
    this.energy = Math.min(this.maxEnergy, before + amount);
    const applied = this.energy - before;
    if (applied !== 0) this.emit('energy', { energy: this.energy, delta: applied, max: this.maxEnergy });
    return applied;
  }

  /** Spend EP directly (used by the conversion step and, later, EP abilities). */
  consumeEnergy(amount) {
    if (!(amount > 0)) return 0;
    const before = this.energy;
    this.energy = Math.max(0, before - amount);
    const spent = before - this.energy;
    if (spent !== 0) this.emit('energy', { energy: this.energy, delta: -spent, max: this.maxEnergy });
    return spent;
  }

  // ------------------------------------------------------------ conversion --

  startConversion() {
    if (this.converting || !this.canConvert) return false;
    this.converting = true;
    this.stopReason = null;
    this.emit('conversion', { active: true, reason: 'started' });
    return true;
  }

  stopConversion(reason = 'manual') {
    if (!this.converting) return false;
    this.converting = false;
    this.stopReason = reason;
    this.emit('conversion', { active: false, reason });
    return true;
  }

  toggleConversion() {
    return this.converting ? this.stopConversion('manual') : this.startConversion();
  }

  /**
   * Converts EP into HP at `conversionRate` EP per second.
   *
   * Stops on its own the moment HP reaches max HP or EP runs out, so the pool
   * can never be spent into an overflow.
   */
  update(dt) {
    if (!this.converting) return 0;
    if (this.dead) {
      this.stopConversion('dead');
      return 0;
    }
    if (this.hp >= this.maxHealth) {
      this.stopConversion('hp-full');
      return 0;
    }
    if (this.energy <= 0) {
      this.stopConversion('ep-empty');
      return 0;
    }

    const energyBudget = this.conversionRate * dt;
    const hpBudget = (this.maxHealth - this.hp) / this.hpPerEnergy;
    const spent = this.consumeEnergy(Math.min(energyBudget, hpBudget));
    const healed = this.health.heal(spent * this.hpPerEnergy);
    if (this.energy <= 0 || this.hp >= this.maxHealth) {
      this.stopConversion(this.energy <= 0 ? 'ep-empty' : 'hp-full');
    }
    return healed;
  }

  // ---------------------------------------------------------------- health --

  applyDamage(amount, meta = {}) {
    const result = this.health.applyDamage(amount, meta);
    // A hit does not cancel conversion on its own - the player keeps the boost
    // they already have and can stop it manually. Kept explicit so a future
    // balance pass can flip this in one place.
    return result;
  }

  heal(amount) {
    return this.health.heal(amount);
  }

  /** Full reset for a fresh run (never called on elimination - there is none). */
  reset({ health = this.maxHealth, energy = 0 } = {}) {
    this.health.reset(health);
    this.energy = clamp(energy, 0, this.maxEnergy);
    this.converting = false;
    this.emit('energy', { energy: this.energy, delta: 0, max: this.maxEnergy });
    return this;
  }

  toJSON() {
    return {
      hp: this.hp,
      maxHp: this.maxHealth,
      energy: this.energy,
      maxEnergy: this.maxEnergy,
      converting: this.converting,
      hpPerEnergy: this.hpPerEnergy,
      conversionRate: this.conversionRate,
    };
  }
}
