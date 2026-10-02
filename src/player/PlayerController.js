import * as THREE from 'three';
import { angleDelta, clamp, moveTowards } from '../utils/math.js';
import { Emitter } from '../core/events.js';
import { CharacterConfig } from './CharacterConfig.js';

/**
 * Kinematic character movement.
 *
 * Pure simulation: it takes an intent (already device-agnostic) plus the camera
 * yaw, and mutates a small state object. It never touches the scene graph, the
 * DOM or the input devices - which is exactly what makes it reusable for bots
 * and for netcode later on (feed it a remote intent, read back the state).
 *
 * Pipeline per step:
 *   1. intent -> world-space direction (relative to the camera)
 *   2. horizontal acceleration / friction, jump + coyote time + jump buffering
 *   3. horizontal move with collision and slide (axis separated)
 *   4. vertical integration, ground snap, step-up and landing
 */
export class PlayerController {
  /**
   * @param {object} options
   * @param {{collider: import('../physics/Collider.js').Collider}} options.world
   * @param {import('./CharacterConfig.js').CharacterConfig|object} [options.config]
   */
  constructor({ world, config = new CharacterConfig() }) {
    this.world = world;
    this.collider = world.collider;
    this.config = config;
    this.events = new Emitter();
    this.body = {
      radius: config.radius,
      height: config.height,
      stepHeight: config.stepHeight,
    };

    /**
     * Aiming down sights turns the character into a strafing turret: it faces
     * the camera instead of the movement direction and moves slower. Both are
     * owned by whoever sets them (the combat system), never by the controller.
     */
    this.aimMode = false;
    this.speedScale = 1;

    this.state = {
      position: new THREE.Vector3(config.spawn.x, 0, config.spawn.z),
      velocity: new THREE.Vector3(),
      yaw: 0,
      speed: 0,
      onGround: false,
      sprinting: false,
      moving: false,
      jumpBuffer: 0,
      coyote: 0,
      airTime: 0,
      jumps: 0,
    };
  }

  // ------------------------------------------------------------------ api --

  respawn(position, yaw = 0) {
    const st = this.state;
    st.position.copy(position);
    st.velocity.set(0, 0, 0);
    st.yaw = yaw;
    st.speed = 0;
    st.onGround = true;
    st.jumpBuffer = 0;
    st.coyote = this.config.coyoteTime;
    this.events.emit('respawn', { position: st.position });
  }

  teleport(x, y, z) {
    this.state.position.set(x, y, z);
    this.state.velocity.set(0, 0, 0);
  }

  /**
   * @param {number} dt fixed timestep
   * @param {{move:{x:number,y:number}, jumpQueued:boolean, jumpHeld:boolean, sprintHeld:boolean}} intent
   * @param {number} [cameraYaw] yaw the player is looking along; defaults to
   *        the character's own facing (no camera attached)
   */
  update(dt, intent, cameraYaw = this.state.yaw) {
    const cfg = this.config;
    const st = this.state;
    const wasOnGround = st.onGround;

    // --- 1. intent -> world direction ------------------------------------
    const moveForward = clamp(intent?.move?.y ?? 0, -1, 1);
    const moveRight = clamp(intent?.move?.x ?? 0, -1, 1);
    const inputMagnitude = Math.hypot(moveForward, moveRight);
    const moving = inputMagnitude > 0.08;
    st.moving = moving;
    st.sprinting = moving && Boolean(intent?.sprintHeld) && moveForward > -0.1;

    // Camera forward is (-sin, 0, -cos), right is (cos, 0, -sin).
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let dirX = -sin * moveForward + cos * moveRight;
    let dirZ = -cos * moveForward - sin * moveRight;
    const dirLength = Math.hypot(dirX, dirZ);
    if (dirLength > 1e-5) {
      dirX /= dirLength;
      dirZ /= dirLength;
    }

    // --- 2. timers, jump, acceleration -----------------------------------
    st.jumpBuffer = intent?.jumpQueued
      ? cfg.jumpBufferTime
      : Math.max(0, st.jumpBuffer - dt);
    st.coyote = wasOnGround ? cfg.coyoteTime : Math.max(0, st.coyote - dt);

    if (st.jumpBuffer > 0 && st.coyote > 0) {
      st.velocity.y = cfg.jumpSpeed;
      st.jumpBuffer = 0;
      st.coyote = 0;
      st.onGround = false;
      st.jumps += 1;
      this.events.emit('jump', { position: st.position, jumps: st.jumps });
    }

    const targetSpeed = (st.sprinting ? cfg.sprintSpeed : cfg.walkSpeed) * this.speedScale;
    const accel = (wasOnGround ? cfg.groundAcceleration : cfg.groundAcceleration * cfg.airControl) * dt;
    // Analog input keeps its magnitude; keyboard/touch sticks are already 1.
    const inputScale = Math.min(1, inputMagnitude);
    const targetVx = dirX * targetSpeed * inputScale;
    const targetVz = dirZ * targetSpeed * inputScale;

    if (moving) {
      st.velocity.x = moveTowards(st.velocity.x, targetVx, accel);
      st.velocity.z = moveTowards(st.velocity.z, targetVz, accel);
    } else if (wasOnGround) {
      const drop = cfg.groundFriction * dt;
      st.velocity.x = moveTowards(st.velocity.x, 0, drop);
      st.velocity.z = moveTowards(st.velocity.z, 0, drop);
    }

    // --- 3. horizontal move ----------------------------------------------
    const feetY = st.position.y;
    this._moveHorizontal(st.position, st.velocity.x * dt, st.velocity.z * dt, feetY, st);

    // --- 4. vertical ------------------------------------------------------
    st.velocity.y = Math.max(st.velocity.y - cfg.gravity * dt, -cfg.terminalVelocity);
    st.position.y += st.velocity.y * dt;

    const groundY = this.collider.groundHeightAt(st.position.x, st.position.z, feetY, this.body);
    let landed = false;

    if (st.position.y <= groundY) {
      landed = !wasOnGround && st.velocity.y < -2;
      st.position.y = groundY;
      st.velocity.y = 0;
      st.onGround = true;
    } else if (wasOnGround && st.velocity.y <= 0 && st.position.y - groundY <= cfg.stepHeight) {
      // Walking down a slope: stay glued to the ground instead of hopping.
      st.position.y = groundY;
      st.velocity.y = 0;
      st.onGround = true;
    } else {
      st.onGround = false;
    }

    if (landed) this.events.emit('land', { position: st.position, speed: Math.abs(st.velocity.y) });

    // --- facing + derived values -----------------------------------------
    if (this.aimMode) {
      // While aiming, the body follows the aim direction (camera yaw).
      const delta = angleDelta(st.yaw, cameraYaw);
      st.yaw += delta * Math.min(1, cfg.turnLambda * 1.4 * dt);
    } else if (moving) {
      const targetYaw = Math.atan2(-dirX, -dirZ);
      const delta = angleDelta(st.yaw, targetYaw);
      st.yaw += delta * Math.min(1, cfg.turnLambda * dt);
    }

    st.speed = Math.hypot(st.velocity.x, st.velocity.z);
    st.airTime = st.onGround ? 0 : st.airTime + dt;
    return st;
  }

  // ------------------------------------------------------------ internals --

  _moveHorizontal(position, dx, dz, feetY, st) {
    const startX = position.x;
    const startZ = position.z;

    if (dx === 0 && dz === 0) return;

    if (this._tryPosition(position, startX + dx, startZ + dz, feetY)) return;

    // Blocked: slide along the free axis instead of stopping dead.
    let movedX = false;
    let movedZ = false;

    if (dx !== 0 && this._tryPosition(position, startX + dx, startZ, feetY)) movedX = true;
    else position.x = startX;

    if (dz !== 0 && this._tryPosition(position, position.x, startZ + dz, feetY)) movedZ = true;
    else position.z = startZ;

    if (dx !== 0 && !movedX) st.velocity.x = 0;
    if (dz !== 0 && !movedZ) st.velocity.z = 0;
  }

  _tryPosition(position, x, z, feetY) {
    position.x = x;
    position.z = z;
    this.collider.resolveHorizontal(position, this.body);
    return this._canStandAt(position.x, position.z, feetY);
  }

  /**
   * Rejects a move whose ground is either more than one step above the feet
   * (a ledge or a crate lip) or too steep to walk up (a cliff).
   */
  _canStandAt(x, z, feetY) {
    const ground = this.collider.groundHeightAt(x, z, feetY, this.body);
    const rise = ground - feetY;
    if (rise <= 1e-4) return true;
    if (rise > this.config.stepHeight + 0.02) return false;
    return this.collider.slopeAt(x, z) <= this.config.maxSlope;
  }
}
