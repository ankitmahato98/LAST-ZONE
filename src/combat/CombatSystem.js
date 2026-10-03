import * as THREE from 'three';
import { COMBAT, EP, HEALTH, PLAYER } from '../config/settings.js';
import { Health } from './Health.js';
import { Vitals } from './Vitals.js';
import { Damageable } from './Damageable.js';
import { applySpread, pointAt, traceShot } from './Hitscan.js';
import { Random } from '../utils/rng.js';
import { clamp } from '../utils/math.js';
import { createWeapon } from './weapons/WeaponTypes.js';
import { WeaponView } from './weapons/WeaponView.js';

/**
 * The combat system: one weapon in hand, one damageable body of our own.
 *
 * Phase B: the player *starts unarmed* and every weapon comes from the world
 * loot (`InventorySystem` calls `equipWeapon()` with a live `Weapon` instance).
 * The system therefore treats "no weapon" as a normal state: firing, spread and
 * ammo all report zero and none of the loot/inventory code has to special case
 * anything here.
 *
 * Structure (this is what makes more weapons cheap to add):
 *   - `Weapon`      pure state machine (magazine, reload, cooldown, spread)
 *   - `Hitscan`     pure hit detection over damageables + world collider
 *   - `WeaponView`  the mesh and its pose
 *   - `CombatEffects` tracers, muzzle flash, impacts
 *   - this class    glue: reads the shared `intent`, drives them, publishes events
 *
 * Design decisions worth knowing:
 *  - **Shots are traced from the camera, drawn from the muzzle.** Tracing from
 *    the muzzle would make the point of impact disagree with the crosshair at
 *    close range; drawing from the muzzle keeps the tracer honest with the model.
 *  - **The player body is a `Damageable` too**, so bot weapons (later) can shoot
 *    the player with exactly the same code path used here.
 *  - **Events, not direct references**: health/ammo/HUD listen to the bus, so the
 *    HUD can be deleted without touching combat.
 *
 * Events: `weapon:equip`, `weapon:fired`, `weapon:dry`, `weapon:reload:start`,
 * `weapon:reload:end`, `combat:hit`, `combat:kill`, `combat:impact`,
 * `combat:player:hurt`, `combat:player:eliminated`.
 */
export class CombatSystem {
  constructor({
    config = COMBAT,
    healthConfig = HEALTH,
    epConfig = EP,
    /** Leave null for the loot-driven flow; pass an id to spawn armed (tests). */
    weaponId = null,
    seed = 'last-zone-01',
    weaponFactory = createWeapon,
  } = {}) {
    this.name = 'combat';
    this.config = config;
    this.healthConfig = healthConfig;
    this.epConfig = epConfig;
    this.startingWeaponId = weaponId;
    this.weaponFactory = weaponFactory;
    this.random = new Random(`${seed}:combat`);

    this.weapon = null;
    this.weaponView = null;
    this.vitals = null;
    this.playerHealth = null;
    this.playerDamageable = null;

    this.aiming = false;
    this.aimBlend = 0;
    this.eliminated = false;
    this.protectionTimer = 0;

    this.stats = { shots: 0, hits: 0, headshots: 0, kills: 0, damageDealt: 0, damageTaken: 0 };
    this._tmpDirection = new THREE.Vector3();
    this._tmpCameraDirection = new THREE.Vector3();
    this._tmpMuzzle = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ setup --

  async init(game) {
    this.game = game;
    this.bus = game.bus;
    this.world = game.services.require('world');
    this.player = game.services.require('player');
    this.input = game.services.get('input');
    this.cameraSystem = game.services.get('camera3p');
    this.characterView = game.services.get('characterView');
    this.targets = game.services.get('targets');
    this.effects = game.services.get('combatEffects');

    // --- the player's own vitals ------------------------------------------
    // Vitals owns HP *and* EP (max 200 / 300, 1 EP = 1 HP, conversion 1 EP/s).
    this.vitals = new Vitals({
      maxHealth: this.healthConfig.playerMax,
      maxEnergy: this.epConfig.max,
      hpPerEnergy: this.epConfig.hpPerEnergy,
      conversionRate: this.epConfig.conversionRate,
    });
    this.playerHealth = this.vitals.health;
    this.playerHealth.on('damaged', ({ applied, health, meta }) => {
      this.stats.damageTaken += applied;
      this.bus.emit('combat:player:hurt', { amount: applied, health, max: this.playerHealth.max, meta });
      this.cameraSystem?.addShake?.(clamp(applied / 60, 0.05, 0.35));
    });
    this.playerHealth.on('died', ({ meta }) => this._eliminate(meta));

    this.playerDamageable = new Damageable({
      id: 'player',
      position: this.player.position,
      health: this.playerHealth,
      radius: PLAYER.radius * 1.15,
      height: PLAYER.height,
      team: 'player',
      kind: 'player',
      owner: this,
    });
    game.services.register('vitals', this.vitals);
    game.services.register('playerHealth', this.playerHealth);
    game.services.register('playerDamageable', this.playerDamageable);

    // --- the weapon -------------------------------------------------------
    // Unarmed by default: the first weapon comes from a world pickup. Tests and
    // future modes can still request a starting weapon explicitly.
    if (this.startingWeaponId) this.equipWeapon(this.startingWeaponId);

    // --- reactions --------------------------------------------------------
    this._unsubscribe = [
      this.bus.on('player:land', ({ speed }) => this._applyFallDamage(speed)),
      this.bus.on('debug:damage', ({ amount = this.config.debugDamageAmount } = {}) =>
        this.damagePlayer(amount, { source: 'debug' })),
    ];

    // Spawn protection so a fresh spawn is not instantly punished.
    this.protectionTimer = this.healthConfig.spawnProtection;
    this.bus.emit('combat:ready', {
      weapon: this.weapon?.id ?? null,
      health: this.playerHealth.current,
      energy: this.vitals.energy,
    });
  }

  /**
   * Puts a weapon in the player's hands.
   *
   * @param {string|import('./weapons/Weapon.js').Weapon} weaponOrId a weapon id
   *        (a fresh instance is built) or a live `Weapon` from the inventory -
   *        which is how the loot flow preserves magazine state across a swap.
   */
  equipWeapon(weaponOrId, overrides = {}) {
    this.weaponView?.dispose();
    this.weapon?.events.clear();

    this.weapon = typeof weaponOrId === 'string'
      ? this.weaponFactory(weaponOrId, overrides)
      : weaponOrId;
    if (!this.weapon) return null;
    this.weapon.on('fired', (payload) => this._onWeaponFired(payload));
    this.weapon.on('dry', () => this.weapon.startReload());
    this.weapon.on('reload:start', (payload) =>
      this.bus.emit('weapon:reload:start', { ...payload, weapon: payload.weapon.id }));
    this.weapon.on('reload:end', (payload) =>
      this.bus.emit('weapon:reload:end', { ...payload, weapon: payload.weapon.id }));

    const attachTo = this.characterView?.arms?.right?.hand ?? this.characterView?.hips ?? null;
    this.weaponView = new WeaponView(this.weapon, {
      attachTo,
      quality: this.game?.settings?.profile,
    });
    this.effects?.attachMuzzleFlash(this.weaponView.muzzle, {
      color: this.weaponView.model.userData.muzzleFlashColor ?? 0xffcf7a,
    });

    this.bus.emit('weapon:equip', { weapon: this.weapon.id, name: this.weapon.name });
    return this.weapon;
  }

  /** Empty hands: no weapon, no view. Used when the last slot is dropped. */
  unequipWeapon() {
    if (!this.weapon && !this.weaponView) return false;
    this.weaponView?.dispose();
    this.weaponView = null;
    this.weapon?.events.clear();
    this.weapon = null;
    this.aiming = false;
    this.aimBlend = 0;
    this.bus.emit('weapon:equip', { weapon: null, name: 'Unarmed' });
    return true;
  }

  get isArmed() {
    return Boolean(this.weapon);
  }

  // ------------------------------------------------------------- accessors --

  get health() {
    return this.playerHealth.current;
  }

  get maxHealth() {
    return this.playerHealth.max;
  }

  get healthFraction() {
    return this.playerHealth.fraction;
  }

  get ammo() {
    return this.weapon?.ammo ?? EMPTY_AMMO;
  }

  get isReloading() {
    return this.weapon?.isReloading ?? false;
  }

  /** Current EP (0..300). Never regenerates passively. */
  get energy() {
    return this.vitals.energy;
  }

  get maxEnergy() {
    return this.vitals.maxEnergy;
  }

  get isEliminated() {
    return this.eliminated;
  }

  get kills() {
    return this.stats.kills;
  }

  get isProtected() {
    return this.protectionTimer > 0;
  }

  get spread() {
    if (!this.weapon) return UNARMED_SPREAD;
    return this.weapon.spreadAt({
      aiming: this.aiming,
      moving: Boolean(this.player.state?.moving),
    });
  }

  /** Every hittable actor, including ourselves (so bots can shoot us later). */
  get damageables() {
    return [this.playerDamageable, ...(this.targets?.damageables ?? [])];
  }

  // ------------------------------------------------------------ simulation --

  fixedUpdate(dt) {
    const intent = this.input?.intent;

    this.vitals.update(dt);
    this._updateAim(dt, intent);
    this._updateProtection(dt);
    this.weapon?.update(dt);
    this._updateFiring(intent);
    this._updateControllerState();
  }

  _updateAim(dt, intent) {
    const wantsAim = !this.eliminated && this.isArmed && Boolean(intent?.aimHeld);
    this.aiming = wantsAim;
    const target = wantsAim ? 1 : 0;
    const lambda = this.config.aim.transitionLambda;
    this.aimBlend += (target - this.aimBlend) * Math.min(1, lambda * dt);
  }

  _updateProtection(dt) {
    if (this.protectionTimer > 0) {
      this.protectionTimer = Math.max(0, this.protectionTimer - dt);
      if (this.protectionTimer === 0) this.bus.emit('combat:protection:end');
    }
  }

  _updateFiring(intent) {
    if (this.eliminated || !this.weapon) return;
    if (intent?.reloadPressed) this.weapon.startReload();

    const wanted = this.weapon.type.automatic
      ? Boolean(intent?.primaryHeld)
      : Boolean(intent?.primaryPressed);

    if (!wanted) return;

    // An empty magazine reloads automatically: the weapon emits `dry` and its
    // own listener (wired in `equipWeapon`) starts the reload.
    this.weapon.tryFire({
      aiming: this.aiming,
      moving: Boolean(this.player.state?.moving),
    });
  }

  /** Recoil, aim pose and movement speed are shared with the player/camera. */
  _updateControllerState() {
    const controller = this.player.controller;
    if (!controller) return;

    const aiming = this.aiming && !this.eliminated && this.isArmed;
    controller.aimMode = aiming;
    controller.speedScale = aiming ? this.config.aim.moveSpeedScale : 1;
  }

  update(dt) {
    const controller = this.player.controller;
    this.cameraSystem?.setAim?.(this.aimBlend);
    this.weaponView?.update(dt, {
      aiming: this.aiming,
      reloading: this.weapon?.isReloading ?? false,
      reloadProgress: this.weapon?.reloadProgress ?? 1,
      moving: Boolean(controller?.state.moving),
    });
    this.characterView?.alignWeaponSupport?.();
  }

  // -------------------------------------------------------------- shooting --

  _onWeaponFired({ weapon, spread }) {
    this.stats.shots += 1;

    const camera = this.cameraSystem?.camera;
    if (!camera) return;

    const origin = camera.position;
    camera.getWorldDirection(this._tmpCameraDirection);
    const muzzle = this.weaponView?.getWorldMuzzle(this._tmpMuzzle) ?? origin;

    const pellets = Math.max(1, weapon.type.pellets ?? 1);
    for (let i = 0; i < pellets; i += 1) {
      applySpread(this._tmpCameraDirection, spread, this.random, this._tmpDirection);
      this._resolveShot(origin, this._tmpDirection, muzzle, weapon);
    }

    this.cameraSystem?.addRecoil?.({
      vertical: weapon.type.recoil?.vertical ?? 0,
      horizontal: weapon.type.recoil?.horizontal ?? 0,
      random: this.random,
    });
    this.effects?.spawnMuzzleFlash({ scale: pellets > 1 ? 1.4 : 1 });
    this.bus.emit('weapon:fired', { weapon: weapon.id, spread, magazine: weapon.magazine });
  }

  /** One pellet: trace, damage, feedback. */
  _resolveShot(origin, direction, muzzle, weapon) {
    const hit = traceShot(origin, direction, {
      collider: this.world.collider,
      actors: this.damageables,
      ignoreId: this.playerDamageable.id,
      maxDistance: this.config.maxRayDistance,
      step: 0.5,
    });

    const endPoint = hit.hit ? hit.point : pointAt(origin, direction, weapon.type.range);
    this.effects?.spawnTracer(muzzle, endPoint, {
      color: this.weaponView?.model.userData.tracerColor ?? 0xffe6a8,
    });

    if (!hit.hit) {
      this.bus.emit('combat:miss', { weapon: weapon.id, point: endPoint });
      return;
    }

    if (hit.actor) {
      this._applyHit(hit, weapon);
      return;
    }

    this.effects?.spawnImpact(hit.point, hit.normal, { color: 0xffd9a0 });
    this.bus.emit('combat:impact', { point: hit.point, normal: hit.normal, weapon: weapon.id });
  }

  _applyHit(hit, weapon) {
    const { actor, point, distance } = hit;
    const headshot = actor.isHeadshot(point.y);
    const baseDamage = weapon.damageAt(distance);
    const damage = baseDamage * (headshot ? weapon.type.headshotMultiplier ?? 1 : 1);

    const result = actor.takeDamage(damage, {
      source: this.playerDamageable.id,
      weapon: weapon.id,
      headshot,
      distance,
      point,
    });

    const event = {
      actor: actor.id,
      kind: actor.kind,
      damage: result.applied,
      headshot,
      distance,
      point,
      killed: result.killed,
      weapon: weapon.id,
    };

    this.stats.hits += 1;
    this.stats.damageDealt += result.applied;
    if (headshot) this.stats.headshots += 1;

    // Impact spark: red-ish for actors, so body shots read differently.
    this.effects?.spawnImpact(point, null, { color: 0xff8f7a, life: 0.35 });
    this.bus.emit('combat:hit', event);

    if (result.killed) {
      this.stats.kills += 1;
      this.bus.emit('combat:kill', event);
      this.bus.emit('combat:elimination', { actor: actor.id, kind: actor.kind, weapon: weapon.id });
    }
  }

  // ------------------------------------------------------ taking damage ----

  /**
   * Applies damage to the player. Public because bots, fall damage, a future
   * zone system and debug tools all share it.
   */
  damagePlayer(amount, meta = {}) {
    if (this.eliminated) return { applied: 0, absorbed: 0, killed: false, ignored: true };
    if (this.protectionTimer > 0) {
      this.bus.emit('combat:player:protected', { amount, meta });
      return { applied: 0, absorbed: amount, killed: false, ignored: true };
    }
    return this.playerHealth.applyDamage(amount, meta);
  }

  healPlayer(amount) {
    return this.vitals.heal(amount);
  }

  /** EP from a consumable - capped at 300 by Vitals. */
  addEnergy(amount) {
    return this.vitals.addEnergy(amount);
  }

  _applyFallDamage(landingSpeed) {
    const excess = landingSpeed - this.healthConfig.fallDamageSpeed;
    if (excess <= 0) return 0;
    const damage = excess * this.healthConfig.fallDamagePerSpeed;
    const result = this.damagePlayer(damage, { source: 'fall', speed: landingSpeed });
    if (result.applied > 0) this.bus.emit('combat:player:fall', { damage: result.applied, speed: landingSpeed });
    return result.applied;
  }

  _eliminate(meta = {}) {
    if (this.eliminated) return;
    this.eliminated = true;
    this.aiming = false;
    this.aimBlend = 0;
    // Permanent: nothing below re-enables control, re-arms a weapon or resets
    // vitals. There is no respawn path anywhere in the codebase.
    this.weapon?.cancelReload();
    this.vitals.stopConversion('eliminated');

    // Stop dead: zero the momentum so the body does not slide.
    this.player.velocity?.set(0, 0, 0);

    this.bus.emit('combat:player:eliminated', {
      meta,
      kills: this.stats.kills,
      position: { ...this.player.position },
    });
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
    this.weaponView?.dispose();
    this.weapon?.events.clear();
  }
}

/** Ammo readout while unarmed - keeps the HUD/tests free of null checks. */
export const EMPTY_AMMO = Object.freeze({
  magazine: 0,
  reserve: 0,
  magazineSize: 0,
  reloading: false,
  reloadProgress: 1,
});

/** Fists read as a wide, honest cone rather than a laser. */
export const UNARMED_SPREAD = 0.02;
