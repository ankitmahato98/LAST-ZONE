import { Emitter } from '../../core/events.js';
import { clamp } from '../../utils/math.js';
import { COMBAT } from '../../config/settings.js';

/**
 * Weapon state machine: magazine, reserve ammo, fire rate cooldown, reload and
 * shot spread.
 *
 * Pure logic on a fixed timestep - it has no idea about meshes, input devices or
 * the world, which is what makes it testable and reusable (a bot fires a Weapon
 * the same way the player does). Every number comes from the weapon `type`
 * definition in `config/settings.js`, so new weapons are data, not code.
 *
 * Events: `fired`, `dry` (trigger with an empty magazine), `reload:start`,
 * `reload:end`, `reload:cancelled`.
 */
export class Weapon extends Emitter {
  constructor({ type, magazine = null, reserve = null } = {}) {
    super();
    if (!type) throw new Error('Weapon requires a type definition');

    this.type = type;
    this.magazineSize = type.magazineSize;
    this.magazine = magazine ?? type.magazineSize;
    this.reserve = reserve ?? type.reserveAmmo ?? 0;
    this.falloff = type.falloff ?? {
      start: COMBAT.falloffStart,
      end: COMBAT.falloffEnd,
      minScale: COMBAT.minFalloffScale,
    };

    /** Seconds until the next shot is allowed. */
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    /** Spread added by sustained fire, decays over time. */
    this.bloom = 0;
    this.shotsFired = 0;
  }

  // -------------------------------------------------------------- accessors --

  get id() {
    return this.type.id;
  }

  get name() {
    return this.type.name ?? this.type.id;
  }

  get isReloading() {
    return this.reloading;
  }

  get reloadProgress() {
    if (!this.reloading || this.type.reloadTime <= 0) return this.reloading ? 0 : 1;
    return clamp(1 - this.reloadTimer / this.type.reloadTime, 0, 1);
  }

  get isMagazineEmpty() {
    return this.magazine <= 0;
  }

  get ammo() {
    return {
      magazine: this.magazine,
      reserve: this.reserve,
      magazineSize: this.magazineSize,
      reloading: this.reloading,
      reloadProgress: this.reloadProgress,
    };
  }

  /** Ready to shoot right now? */
  canFire() {
    return !this.reloading && this.cooldown <= 0 && this.magazine > 0;
  }

  // ----------------------------------------------------------- spread/damage --

  /**
   * Current cone half-angle in radians.
   * @param {{aiming?:boolean, moving?:boolean}} [state]
   */
  spreadAt({ aiming = false, moving = false } = {}) {
    const spread = this.type.spread ?? {};
    let base = spread.standing ?? 0.01;
    if (moving) base = spread.moving ?? base * 2;
    if (aiming) base = spread.aiming ?? base * 0.4;
    return Math.min(base + this.bloom, spread.max ?? 0.06);
  }

  /** Damage after range falloff. */
  damageAt(distance) {
    const { start, end, minScale } = this.falloff;
    if (distance <= start || end <= start) return this.type.damage;
    const t = clamp((distance - start) / (end - start), 0, 1);
    return this.type.damage * (1 - t * (1 - minScale));
  }

  // --------------------------------------------------------------- simulation --

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    const spread = this.type.spread ?? {};
    if (this.bloom > 0) {
      this.bloom = Math.max(0, this.bloom - (spread.recovery ?? 3) * dt);
    }

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }
  }

  /**
   * Pull the trigger for this step.
   * @returns {{fired:boolean, reason:string|null, spread:number, magazine:number}}
   */
  tryFire({ aiming = false, moving = false } = {}) {
    if (this.reloading) return this._fail('reloading');
    if (this.cooldown > 0) return this._fail('cooldown');
    if (this.magazine <= 0) {
      this.emit('dry', { weapon: this });
      return this._fail('empty');
    }

    const spread = this.spreadAt({ aiming, moving });
    this.magazine -= 1;
    this.shotsFired += 1;
    this.cooldown = 1 / this.type.fireRate;
    this.bloom = Math.min(
      this.bloom + (this.type.spread?.perShot ?? 0),
      (this.type.spread?.max ?? 0.06) * 2,
    );

    this.emit('fired', {
      weapon: this,
      spread,
      magazine: this.magazine,
      reserve: this.reserve,
    });

    return { fired: true, reason: null, spread, magazine: this.magazine };
  }

  /**
   * Begin a reload. Returns `{started, reason}` - the caller can surface the
   * reason ("full", "no-ammo") in the HUD.
   */
  startReload() {
    if (this.reloading) return { started: false, reason: 'reloading' };
    if (this.magazine >= this.magazineSize) return { started: false, reason: 'full' };
    if (this.reserve <= 0) return { started: false, reason: 'no-ammo' };

    this.reloading = true;
    this.reloadTimer = this.type.reloadTime;
    this.emit('reload:start', { weapon: this, duration: this.type.reloadTime });
    return { started: true, reason: null };
  }

  cancelReload() {
    if (!this.reloading) return false;
    this.reloading = false;
    this.reloadTimer = 0;
    this.emit('reload:cancelled', { weapon: this });
    return true;
  }

  /** Top the weapon back up - respawn, or a future ammo pickup. */
  refill({ reserve = true } = {}) {
    this.magazine = this.magazineSize;
    if (reserve) this.reserve = this.type.reserveAmmo ?? this.reserve;
    this.cancelReload();
    this.cooldown = 0;
    this.bloom = 0;
  }

  addReserve(amount) {
    this.reserve = Math.max(0, this.reserve + amount);
    return this.reserve;
  }

  // ------------------------------------------------------------- internals --

  _finishReload() {
    const needed = this.magazineSize - this.magazine;
    const transfer = Math.min(needed, this.reserve);
    this.magazine += transfer;
    this.reserve -= transfer;
    this.reloading = false;
    this.reloadTimer = 0;
    this.emit('reload:end', { weapon: this, transfer, magazine: this.magazine, reserve: this.reserve });
  }

  _fail(reason) {
    return { fired: false, reason, spread: 0, magazine: this.magazine };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      magazine: this.magazine,
      reserve: this.reserve,
      magazineSize: this.magazineSize,
      reloading: this.reloading,
      reloadProgress: this.reloadProgress,
      shotsFired: this.shotsFired,
      spread: this.spreadAt({}),
    };
  }
}
