import * as THREE from 'three';
import { Damageable } from './Damageable.js';
import { Health } from './Health.js';
import { CircleBlocker } from '../physics/Collider.js';
import { Random } from '../utils/rng.js';
import { clamp, damp } from '../utils/math.js';
import { TARGETS, ARENA, COMBAT } from '../config/settings.js';

/**
 * Training dummies: the test bench for the combat systems.
 *
 * A dummy is a normal `Damageable` actor with a small presentation layer (body,
 * damage flash, health bar, fall-over death and automatic rebuild). Nothing in
 * the shooting code knows these are "targets" rather than bots - if you deleted
 * TargetSystem the weapons would happily shoot anything else registered as a
 * damageable.
 */
export class TrainingDummy {
  /**
   * @param {object} options
   * @param {string} options.id
   * @param {number} options.x
   * @param {number} options.z
   * @param {number} options.groundY
   * @param {object} [options.config]
   */
  constructor({
    id,
    x,
    z,
    groundY,
    yaw = 0,
    config = TARGETS,
    respawnDelay = COMBAT.targetRespawnDelay,
    collider = null,
  }) {
    this.id = id;
    this.config = config;
    this.respawnDelay = respawnDelay;
    /** The world's collision set, so solidity can follow life state. */
    this.collider = collider;
    this.spawn = { x, z, groundY, yaw };
    this.deathTimer = 0;
    this.hitFlash = 0;
    this.facing = yaw;

    this.group = new THREE.Group();
    this.group.name = `target-${id}`;
    this.group.position.set(x, groundY, z);

    this._buildBody();

    this.health = new Health({ max: config.maxHealth });
    this.health.on('damaged', ({ applied }) => {
      this.hitFlash = clamp(applied / 30, 0.25, 1);
    });

    this.damageable = new Damageable({
      id,
      // Live reference: the hitbox follows the dummy without any syncing.
      position: this.group.position,
      health: this.health,
      radius: config.radius,
      height: config.height,
      team: 'target',
      kind: 'training-dummy',
      owner: this,
    });

    /** Optional physical presence so the player cannot walk through a dummy. */
    this.blocker = new CircleBlocker({
      x,
      z,
      y: groundY,
      radius: config.radius,
      height: config.height,
      name: `target-${id}`,
    });
    this.setSolid(this.collider, true);

    this.group.rotation.y = yaw;
  }

  // ------------------------------------------------------------------ body --

  _buildBody() {
    const materials = {
      body: new THREE.MeshStandardMaterial({ color: '#c9682f', roughness: 0.75, metalness: 0.15 }),
      frame: new THREE.MeshStandardMaterial({ color: '#3a4046', roughness: 0.8, metalness: 0.3 }),
      head: new THREE.MeshStandardMaterial({ color: '#e8b25a', roughness: 0.7, metalness: 0.1 }),
      marker: new THREE.MeshStandardMaterial({
        color: '#f4f7f8',
        roughness: 0.6,
        emissive: new THREE.Color('#3c3c3c'),
        emissiveIntensity: 0.4,
      }),
    };
    this.materials = materials;
    this._baseColors = new Map();
    for (const [key, material] of Object.entries(materials)) {
      this._baseColors.set(key, material.color.clone());
    }

    const add = (geometry, material, [px, py, pz], name = 'part') => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };

    add(new THREE.CylinderGeometry(this.config.radius * 1.05, this.config.radius * 1.25, 0.1, 14), materials.frame, [0, 0.05, 0], 'base');
    add(new THREE.BoxGeometry(0.1, 1.0, 0.1), materials.frame, [0, 0.55, 0], 'post');
    this.torso = add(new THREE.BoxGeometry(0.62, 0.72, 0.32), materials.body, [0, 1.32, 0], 'torso');
    this.head = add(new THREE.SphereGeometry(0.17, 16, 12), materials.head, [0, 1.82, 0], 'head');

    // Arms out to the sides make the silhouette read at distance.
    add(new THREE.BoxGeometry(1.05, 0.1, 0.12), materials.frame, [0, 1.55, 0], 'arms');
    // Chest marker: the hit-the-centre cue.
    add(new THREE.CircleGeometry(0.14, 20), materials.marker, [0, 1.38, 0.165], 'marker');
    add(new THREE.CircleGeometry(0.07, 20), materials.marker, [0, 1.38, 0.17], 'marker-inner');

    this._buildHealthBar();
  }

  _buildHealthBar() {
    const bar = new THREE.Group();
    bar.position.y = 2.16;
    bar.name = 'health-bar';

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x10161a, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x4ef0c8, transparent: true, depthWrite: false }),
    );
    // Anchor the fill to the left edge so it drains right-to-left.
    this.healthFill.geometry.translate(0.38, 0, 0);
    this.healthFill.position.set(-0.38, 0, 0.01);
    bar.add(back, this.healthFill);
    bar.renderOrder = 8;
    this.healthBar = bar;
    this.group.add(bar);
  }

  // ------------------------------------------------------------- behaviour --

  get alive() {
    return this.health.alive;
  }

  get position() {
    return this.group.position;
  }

  /**
   * @param {number} dt
   * @param {object} [context]
   * @param {{x:number,y:number,z:number}} [context.lookAt] camera/player position
   */
  update(dt, { lookAt = null, cameraQuaternion = null } = {}) {
    // Hit flash fades back to the base colours.
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
      this._applyHitFlash(this.hitFlash);
    }

    if (this.alive) {
      // Stand up again if we were rebuilding, then face the shooter.
      this.group.rotation.x = damp(this.group.rotation.x, 0, 10, dt);
      if (lookAt) {
        const target = Math.atan2(lookAt.x - this.group.position.x, lookAt.z - this.group.position.z);
        this.facing = damp(this.facing, target, 3, dt);
        this.group.rotation.y = this.facing;
      }
    } else {
      this.deathTimer -= dt;
      // Tip over when destroyed.
      this.group.rotation.x = damp(this.group.rotation.x, -Math.PI / 2, 7, dt);
      if (this.deathTimer <= 0) this.respawn();
    }

    this._updateHealthBar(cameraQuaternion);
  }

  _updateHealthBar(cameraQuaternion) {
    const fraction = this.health.fraction;
    this.healthFill.scale.x = Math.max(0.0001, fraction);
    // Billboard: copy the camera's rotation so the bar always faces the viewer.
    if (cameraQuaternion) this.healthBar.quaternion.copy(cameraQuaternion);
    this.healthBar.visible = this.alive || this.health.current > 0;
    this.healthFill.material.color.setHex(fraction > 0.55 ? 0x4ef0c8 : fraction > 0.25 ? 0xffc95c : 0xff6b6b);
  }

  _applyHitFlash(strength) {
    const white = new THREE.Color(0xffffff);
    for (const [key, material] of Object.entries(this.materials)) {
      const base = this._baseColors.get(key);
      material.color.copy(base).lerp(white, strength * 0.8);
    }
  }

  /** Restores full health and stands the dummy back up. */
  respawn() {
    this.health.reset();
    this.damageable.enabled = true;
    this.deathTimer = 0;
    this.group.rotation.x = 0;
    this.group.position.set(this.spawn.x, this.spawn.groundY, this.spawn.z);
    this.group.visible = true;
    this._applyHitFlash(0);
    // Solid again: this is the single place that keeps "alive" and "blocking"
    // in sync, so a fallen dummy can never leave an invisible wall behind.
    this.setSolid(this.collider, true);
  }

  /** Called when health reaches zero - starts the rebuild timer. */
  onDestroyed() {
    this.damageable.enabled = false;
    this.deathTimer = this.respawnDelay;
    this.setSolid(this.collider, false);
  }

  setSolid(collider = this.collider, solid = true) {
    if (!collider?.cylinders) return;
    const index = collider.cylinders.indexOf(this.blocker);
    if (solid && index === -1) {
      if (collider.addCylinder) collider.addCylinder(this.blocker);
      else collider.cylinders.push(this.blocker);
    }
    if (!solid && index !== -1) {
      if (collider.removeCylinder) collider.removeCylinder(this.blocker);
      else collider.cylinders.splice(index, 1);
    }
  }

  dispose() {
    this.group.traverse((child) => child.geometry?.dispose?.());
    for (const material of Object.values(this.materials)) material.dispose();
    this.healthFill.material.dispose();
    this.group.parent?.remove(this.group);
  }
}

/**
 * Spawns and updates the dummy range.
 *
 * Placement uses the same rejection sampling rules as the scenery (inside the
 * arena ring, on flat ground, clear of obstacles), so targets never end up
 * inside a wall.
 */
export class TargetSystem {
  constructor({ config = TARGETS, seed = 'last-zone-01' } = {}) {
    this.name = 'targets';
    this.config = config;
    this.random = new Random(`${seed}:targets`);
    /** @type {TrainingDummy[]} */
    this.dummies = [];
    /** How many dummies have been destroyed (telemetry, resets on rebuild). */
    this.destroyed = 0;
  }

  init(game) {
    this.game = game;
    this.world = game.services.require('world');
    this.renderer = game.services.require('renderer');

    const group = new THREE.Group();
    group.name = 'targets';
    this.group = group;
    this.renderer.worldGroup.add(group);

    for (let i = 0; i < this.config.count; i += 1) {
      const spot = this._findSpot(i);
      const dummy = new TrainingDummy({
        id: `target-${i}`,
        ...spot,
        config: this.config,
        collider: this.world.collider,
      });
      dummy.health.on('died', ({ meta }) => {
        this.destroyed += 1;
        dummy.onDestroyed();
        this.game.bus.emit('target:destroyed', { target: dummy, meta });
      });
      group.add(dummy.group);
      this.dummies.push(dummy);
    }

    game.services.register('targets', this);
    game.bus.emit('targets:ready', { count: this.dummies.length });
  }

  _findSpot(index) {
    const [minRadius, maxRadius] = this.config.radiusRange;
    const body = { radius: this.config.radius + 0.4, height: this.config.height, stepHeight: 0.5 };

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const angle = this.random.range(0, Math.PI * 2);
      const radius = this.random.range(minRadius, maxRadius);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const groundY = this.world.heightAt(x, z);
      if (this.world.slopeAt(x, z) > ARENA.maxSlope) continue;
      if (!this.world.collider.isClear(x, z, groundY, { radius: body.radius, height: body.height })) continue;

      const tooClose = this.dummies.some(
        (dummy) => Math.hypot(dummy.position.x - x, dummy.position.z - z) < 3.5,
      );
      if (tooClose) continue;

      return { x, z, groundY, yaw: Math.atan2(-x, -z) };
    }

    // Deterministic fallback: evenly spread around the ring.
    const angle = (index / this.config.count) * Math.PI * 2;
    const radius = (minRadius + maxRadius) * 0.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return { x, z, groundY: this.world.heightAt(x, z), yaw: Math.atan2(-x, -z) };
  }

  /** Every dummy hitbox - this is what weapons trace against. */
  get damageables() {
    return this.dummies.map((dummy) => dummy.damageable);
  }

  get aliveCount() {
    return this.dummies.filter((dummy) => dummy.alive).length;
  }

  get destroyedCount() {
    return this.dummies.length - this.aliveCount;
  }

  /** Total destructions since boot (survives rebuilds, unlike `destroyedCount`). */
  get totalDestroyed() {
    return this.destroyed;
  }

  fixedUpdate(dt) {
    const player = this.game.services.get('player');
    const camera = this.game.services.get('camera3p');
    const lookAt = player?.position ?? null;
    const quaternion = camera?.camera?.quaternion ?? null;

    for (const dummy of this.dummies) dummy.update(dt, { lookAt, cameraQuaternion: quaternion });
  }

  /** Puts every dummy back on its feet - used by respawn/round restart. */
  resetAll() {
    for (const dummy of this.dummies) dummy.respawn();
    this.game?.bus.emit('targets:reset', { count: this.dummies.length });
  }

  dispose() {
    for (const dummy of this.dummies) {
      dummy.setSolid(this.world.collider, false);
      dummy.dispose();
    }
    this.dummies.length = 0;
    this.group?.parent?.remove(this.group);
  }
}
