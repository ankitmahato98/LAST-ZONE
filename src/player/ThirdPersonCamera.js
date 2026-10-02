import * as THREE from 'three';
import { CAMERA, COMBAT } from '../config/settings.js';
import { clamp, damp, wrapAngle } from '../utils/math.js';

/**
 * Third-person orbit camera.
 *
 * Look input comes from the shared intent object, so mouse-look, drag-look and
 * touch-drag all behave the same (only sensitivity differs). The camera:
 *   - follows a damped pivot above the player (so jumps do not snap the view)
 *   - adjusts its own distance when the terrain or a wall is in the way
 *   - never clips through the ground
 *   - widens the FOV slightly while sprinting
 *
 * Combat feeds it three things, all optional and all owned by the camera once
 * received: `setAim(0..1)` (shoulder aim: closer, offset, tighter FOV),
 * `addRecoil()` (kick that settles) and `addShake()` (damage feedback). Combat
 * never writes camera state directly, which keeps the aim feel in one file.
 *
 * Conventions (shared with PlayerController):
 *   yaw 0 looks down -Z, forward = (-sin yaw, 0, -cos yaw)
 *   positive pitch looks up, `camera.rotation.order = 'YXZ'`
 */
export class ThirdPersonCamera {
  constructor({ camera, input, config = CAMERA }) {
    this.name = 'camera';
    this.camera = camera;
    this.input = input;
    this.config = config;

    this.yaw = 0;
    this.pitch = -0.16;
    this.distance = config.distance;
    this.currentDistance = config.distance;
    this.focus = new THREE.Vector3();

    /** Aim blend (0 hip, 1 down the sights) and the kick it produces. */
    this.aimBlend = 0;
    this.recoil = { pitch: 0, yaw: 0 };
    this.shake = 0;
    this.viewYaw = this.yaw;
    this.viewPitch = this.pitch;

    this._look = { x: 0, y: 0 };
    this._direction = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fov = config.fov ?? camera?.fov ?? 62;
    this._shakeTime = 0;
  }

  init(game) {
    this.game = game;
    this.world = game.services.require('world');
    this.player = game.services.get('player');
    this.camera.rotation.order = 'YXZ';
    // The renderer owns the boot FOV; the camera only modifies it (sprint kick,
    // aim punch), so the base value is read from the live camera.
    this.baseFov = this.config.fov ?? this.camera.fov ?? 62;
    this._fov = this.camera.fov;

    if (this.player) {
      this.yaw = this.player.state.yaw;
      this.focus.set(
        this.player.position.x,
        this.player.position.y + this.config.pivotHeight,
        this.player.position.z,
      );
      this._apply(this.focus);
    }
  }

  // --------------------------------------------------------------- combat --

  /** Combat tells the camera how far into the aim pose it is (0..1). */
  setAim(blend) {
    this.aimBlend = Math.max(0, Math.min(1, blend));
  }

  /** Per-shot kick. Vertical is the main axis, horizontal is randomised. */
  addRecoil({ vertical = 0, horizontal = 0, random = null } = {}) {
    const jitter = random ? random.next() * 2 - 1 : 0;
    this.recoil.pitch += vertical;
    this.recoil.yaw += horizontal * jitter;
    const max = COMBAT.maxRecoil;
    this.recoil.pitch = Math.min(this.recoil.pitch, max);
    this.recoil.yaw = Math.max(-max, Math.min(this.recoil.yaw, max));
  }

  resetRecoil() {
    this.recoil.pitch = 0;
    this.recoil.yaw = 0;
    this.shake = 0;
  }

  /** Short camera shake, e.g. when the player takes a hit. */
  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  // ------------------------------------------------------------ simulation --

  /** Consumes look/zoom input once per fixed step. */
  fixedUpdate(dt) {
    const cfg = this.config;
    const input = this.input;

    const look = input.consumeLook(this._look);
    const touchActive = input.controlMode === 'touch';
    const sensitivity = touchActive ? cfg.touchSensitivity : cfg.mouseSensitivity;
    const invert = cfg.invertY ? -1 : 1;

    this.yaw = wrapAngle(this.yaw - look.x * sensitivity);
    this.pitch = clamp(this.pitch - look.y * sensitivity * invert, cfg.minPitch, cfg.maxPitch);

    // Keyboard look (J/K/I/L) for players without a mouse.
    const keyboardSpeed = cfg.keyboardLookSpeed * dt;
    if (input.isHeld('lookLeft')) this.yaw += keyboardSpeed;
    if (input.isHeld('lookRight')) this.yaw -= keyboardSpeed;
    if (input.isHeld('lookUp')) this.pitch += keyboardSpeed * invert;
    if (input.isHeld('lookDown')) this.pitch -= keyboardSpeed * invert;
    this.pitch = clamp(this.pitch, cfg.minPitch, cfg.maxPitch);

    const zoom = input.consumeZoom();
    if (zoom !== 0) {
      this.distance = clamp(
        this.distance + zoom * cfg.zoomStep,
        cfg.minDistance,
        cfg.maxDistance,
      );
    }

    // Recoil decays back to the player's original aim.
    const recovery = COMBAT.recoilRecovery;
    this.recoil.pitch = damp(this.recoil.pitch, 0, recovery, dt);
    this.recoil.yaw = damp(this.recoil.yaw, 0, recovery, dt);

    this.viewYaw = this.yaw + this.recoil.yaw;
    this.viewPitch = clamp(this.pitch + this.recoil.pitch, cfg.minPitch, cfg.maxPitch);
  }

  // --------------------------------------------------------------- rendering --

  update(dt) {
    const cfg = this.config;
    const player = this.player;
    if (!player) return;

    // --- damped pivot ----------------------------------------------------
    // While aiming, the pivot moves to the shoulder and up slightly, which is
    // what makes the weapon line up with the reticle.
    const aim = this.aimBlend;
    const aimCfg = COMBAT.aim;
    this._right.set(Math.cos(this.viewYaw), 0, -Math.sin(this.viewYaw));
    const shoulder = aim * aimCfg.shoulderOffset;

    this._target.set(
      player.position.x + this._right.x * shoulder,
      player.position.y + cfg.pivotHeight + aim * aimCfg.heightOffset,
      player.position.z + this._right.z * shoulder,
    );
    this.focus.x = damp(this.focus.x, this._target.x, cfg.followLambda, dt);
    this.focus.z = damp(this.focus.z, this._target.z, cfg.followLambda, dt);
    // Vertical follow is lazier so jumps and stairs feel smooth.
    this.focus.y = damp(this.focus.y, this._target.y, cfg.followLambda * 0.55, dt);

    // --- desired distance, shortened by geometry -------------------------
    const desired = this.distance * (1 - aim * (1 - aimCfg.distanceScale));
    const free = this._freeDistance(desired);
    // Pull in immediately, ease back out: avoids both clipping and jitter.
    this.currentDistance =
      free < this.currentDistance
        ? free
        : damp(this.currentDistance, free, 6, dt);

    // Shake decays every frame regardless of the pivot state.
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);

    this._applyPosition(dt);

    // --- fov: sprint kick out, aim punch in ------------------------------
    const base = this.baseFov;
    const sprintKick = player.state.sprinting && player.state.speed > 5 ? cfg.fovSprintBoost ?? 7 : 0;
    const targetFov = (base + sprintKick) * (1 - aim * (1 - aimCfg.fovScale));
    const nextFov = damp(this._fov, targetFov, 6, dt);
    if (Math.abs(nextFov - this._fov) > 0.001) {
      this._fov = nextFov;
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Direction from the pivot towards the camera, for a given yaw/pitch. */
  _offsetDir(yaw = this.viewYaw, pitch = this.viewPitch) {
    const cosPitch = Math.cos(pitch);
    return this._direction.set(
      Math.sin(yaw) * cosPitch,
      -Math.sin(pitch),
      Math.cos(yaw) * cosPitch,
    );
  }

  _applyPosition(dt = 1 / 60) {
    const dir = this._offsetDir(this.viewYaw, this.viewPitch);
    const distance = this.currentDistance;
    this.camera.position.set(
      this.focus.x + dir.x * distance,
      this.focus.y + dir.y * distance,
      this.focus.z + dir.z * distance,
    );

    // Damage shake: a decaying, high frequency wobble on the view angles.
    let shakeYaw = 0;
    let shakePitch = 0;
    if (this.shake > 0.001) {
      this._shakeTime += dt;
      // ~30 Hz wobble, independent of frame rate.
      const phase = this._shakeTime * Math.PI * 60;
      shakeYaw = Math.sin(phase) * this.shake * 0.035;
      shakePitch = Math.cos(phase * 1.37) * this.shake * 0.03;
    }

    this.camera.rotation.set(this.viewPitch + shakePitch, this.viewYaw + shakeYaw, 0);
  }

  _apply(focus) {
    this.focus.copy(focus);
    this._applyPosition();
  }

  /**
   * Points the camera at a world position (aim helpers, look-at targets,
   * scripted camera moves, tests). Re-applies the transform immediately.
   */
  lookAtPoint(point, { yawOnly = false, iterations = 3 } = {}) {
    // Iterate: moving the camera changes the direction to the point, so a
    // single pass would leave a small but visible aim error at range.
    for (let i = 0; i < iterations; i += 1) {
      const dx = point.x - this.camera.position.x;
      const dy = point.y - this.camera.position.y;
      const dz = point.z - this.camera.position.z;
      const horizontal = Math.hypot(dx, dz) || 1e-6;

      this.yaw = wrapAngle(Math.atan2(-dx, -dz));
      if (!yawOnly) {
        this.pitch = clamp(Math.atan2(dy, horizontal), this.config.minPitch, this.config.maxPitch);
      }
      // Aiming at something clears any leftover kick.
      this.recoil.pitch = 0;
      this.recoil.yaw = 0;
      this.viewYaw = this.yaw;
      this.viewPitch = this.pitch;
      this._applyPosition(1 / 60);
    }
    return this;
  }

  /** Smoothly moves the camera (used by tests and cutscene-style transitions). */
  snapToPlayer() {
    const player = this.player;
    if (!player) return;
    this.focus.set(player.position.x, player.position.y + this.config.pivotHeight, player.position.z);
    this.currentDistance = this.distance;
    this._applyPosition();
  }

  /**
   * Largest distance along the view ray that stays out of the world.
   * Marching outwards is enough here: the first blocked sample wins.
   */
  _freeDistance(desired) {
    const cfg = this.config;
    const collider = this.world?.collider;
    if (!collider) return desired;

    const dir = this._offsetDir();
    const samples = cfg.collisionSamples;
    const padding = cfg.collisionPadding;
    const minDistance = Math.max(0.4, cfg.minCollisionDistance * 0.5);

    let free = minDistance;
    const step = Math.max(desired / samples, 0.25);

    for (let t = minDistance; t <= desired; t += step) {
      const x = this.focus.x + dir.x * t;
      const y = this.focus.y + dir.y * t;
      const z = this.focus.z + dir.z * t;
      if (collider.pointBlocked(x, y, z, padding)) break;
      free = t;
    }

    return clamp(free, minDistance, cfg.maxDistance);
  }
}
