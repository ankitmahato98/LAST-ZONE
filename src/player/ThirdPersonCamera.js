import * as THREE from 'three';
import { CAMERA } from '../config/settings.js';
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

    this._look = { x: 0, y: 0 };
    this._direction = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._fov = config.fov;
  }

  init(game) {
    this.game = game;
    this.world = game.services.require('world');
    this.player = game.services.get('player');
    this.camera.rotation.order = 'YXZ';

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
  }

  // --------------------------------------------------------------- rendering --

  update(dt) {
    const cfg = this.config;
    const player = this.player;
    if (!player) return;

    // --- damped pivot ----------------------------------------------------
    this._target.set(
      player.position.x,
      player.position.y + cfg.pivotHeight,
      player.position.z,
    );
    this.focus.x = damp(this.focus.x, this._target.x, cfg.followLambda, dt);
    this.focus.z = damp(this.focus.z, this._target.z, cfg.followLambda, dt);
    // Vertical follow is lazier so jumps and stairs feel smooth.
    this.focus.y = damp(this.focus.y, this._target.y, cfg.followLambda * 0.55, dt);

    // --- desired distance, shortened by geometry -------------------------
    const free = this._freeDistance(this.distance);
    // Pull in immediately, ease back out: avoids both clipping and jitter.
    this.currentDistance =
      free < this.currentDistance
        ? free
        : damp(this.currentDistance, free, 6, dt);

    this._applyPosition();

    // --- fov: subtle sprint kick -----------------------------------------
    const base = cfg.fov ?? 62;
    const targetFov = base + (player.state.sprinting && player.state.speed > 5 ? cfg.fovSprintBoost ?? 0 : 0);
    const nextFov = damp(this._fov, targetFov, 6, dt);
    if (Math.abs(nextFov - this._fov) > 0.001) {
      this._fov = nextFov;
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Direction from the pivot towards the camera, for the current yaw/pitch. */
  _offsetDirection() {
    const cosPitch = Math.cos(this.pitch);
    return this._direction.set(
      Math.sin(this.yaw) * cosPitch,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );
  }

  _applyPosition() {
    const dir = this._offsetDirection();
    const distance = this.currentDistance;
    this.camera.position.set(
      this.focus.x + dir.x * distance,
      this.focus.y + dir.y * distance,
      this.focus.z + dir.z * distance,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  _apply(focus) {
    this.focus.copy(focus);
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

    const dir = this._offsetDirection();
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
