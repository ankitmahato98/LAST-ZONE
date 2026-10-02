import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../utils/math.js';

/**
 * Presentation for the player: a stylised humanoid assembled from primitives
 * with a small hand authored rig (hips, torso, head, two arms, two legs).
 *
 * Why primitives instead of a loaded glTF? Because the foundation must run with
 * zero external assets, and because swapping in a skinned model later only
 * means replacing the two methods that own geometry (`_buildBody`) and
 * animation (`_animate`) - everything else (repo, config, service name) stays.
 *
 * This system only *reads* the player state; it never writes simulation data.
 * Two optional extras come from the combat service (if it is present): the aim
 * blend, which steadies the arms so the weapon points where the player aims, and
 * the elimination state, which tips the body over.
 */
export class CharacterView {
  constructor({ name = 'avatar', colors = null } = {}) {
    this.name = 'characterView';
    this.modelName = name;
    this.colors = { ...DEFAULT_COLORS, ...(colors ?? {}) };

    this.root = new THREE.Group();
    this.root.name = `${name}-root`;

    this.walkPhase = 0;
    this.walkWeight = 0;
    this.airWeight = 0;
    this.materials = [];
    /** Set by combat: the body drops to the ground when eliminated. */
    this.downed = false;
  }

  // ------------------------------------------------------------- lifecycle --

  init(game) {
    this.game = game;
    const renderer = game.services.require('renderer');

    this._buildBody();
    renderer.actorsGroup.add(this.root);

    this.player = game.services.get('player');
    this.camera = game.services.get('camera3p');
    this.view = this._createViewState();
    this._syncFromPlayer(true);

    this.player?.controller?.events.on('jump', () => this._onJump());
    this.player?.controller?.events.on('land', (payload) => this._onLand(payload));

    // Combat feedback that belongs to the body, not the HUD.
    this.combat = game.services.get('combat');
    this._unsubscribe = [
      game.bus.on('combat:player:eliminated', () => {
        this.downed = true;
      }),
      game.bus.on('combat:player:restored', () => {
        this.downed = false;
      }),
    ];
  }

  /** Bounce the model on take off / impact - purely cosmetic. */
  _onJump() {
    this._jumpBounce = 0.12;
  }

  _onLand(payload) {
    this._landBounce = clamp((payload?.speed ?? 0) / 14, 0, 0.28);
  }

  // ------------------------------------------------------------------ body --

  _buildBody() {
    const c = this.colors;
    const material = (color, roughness = 0.75, metalness = 0.05) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.materials.push(mat);
      return mat;
    };

    this.materialsByName = {
      jacket: material(c.jacket, 0.8, 0.05),
      skin: material(c.skin, 0.85, 0),
      pants: material(c.pants, 0.9, 0),
      boots: material(c.boots, 0.7, 0.05),
      pack: material(c.pack, 0.75, 0.1),
      accent: material(c.accent, 0.4, 0.3),
    };

    // model -> the yaw-rotated body; root -> world position of the feet.
    this.model = new THREE.Group();
    this.model.name = `${this.modelName}-model`;
    this.root.add(this.model);

    const hips = new THREE.Group();
    hips.position.y = HIP_HEIGHT;
    this.model.add(hips);

    const torso = mesh(new THREE.BoxGeometry(0.46, 0.52, 0.26), this.materialsByName.jacket);
    torso.position.y = 0.3;
    hips.add(torso);

    const belt = mesh(new THREE.BoxGeometry(0.44, 0.08, 0.28), this.materialsByName.accent);
    belt.position.y = 0.02;
    hips.add(belt);

    const backpack = mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), this.materialsByName.pack);
    backpack.position.set(0, 0.34, 0.24);
    hips.add(backpack);

    // Head on a short neck so it can bob independently of the torso.
    const neck = new THREE.Group();
    neck.position.y = 0.62;
    hips.add(neck);
    const head = mesh(new THREE.SphereGeometry(0.17, 16, 12), this.materialsByName.skin);
    head.position.y = 0.14;
    head.scale.set(0.92, 1.05, 0.95);
    neck.add(head);
    const visor = mesh(new THREE.BoxGeometry(0.3, 0.09, 0.06), this.materialsByName.accent);
    visor.position.set(0, 0.16, -0.15);
    neck.add(visor);
    const helmet = mesh(new THREE.SphereGeometry(0.185, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), this.materialsByName.pack);
    helmet.position.y = 0.15;
    neck.add(helmet);
    this.neck = neck;

    this.arms = {
      left: this._buildLimb({
        pivot: [-0.31, 0.5, 0],
        size: [0.13, 0.54, 0.13],
        offsetY: -0.27,
        material: this.materialsByName.jacket,
        parent: hips,
      }),
      right: this._buildLimb({
        pivot: [0.31, 0.5, 0],
        size: [0.13, 0.54, 0.13],
        offsetY: -0.27,
        material: this.materialsByName.jacket,
        parent: hips,
      }),
    };

    this.legs = {
      left: this._buildLimb({
        pivot: [-0.12, 0, 0],
        size: [0.17, 0.82, 0.17],
        offsetY: -0.41,
        material: this.materialsByName.pants,
        parent: hips,
        boot: this.materialsByName.boots,
      }),
      right: this._buildLimb({
        pivot: [0.12, 0, 0],
        size: [0.17, 0.82, 0.17],
        offsetY: -0.41,
        material: this.materialsByName.pants,
        parent: hips,
        boot: this.materialsByName.boots,
      }),
    };

    this.hips = hips;
    this.root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  _buildLimb({ pivot, size, offsetY, material, parent, boot = null }) {
    const joint = new THREE.Group();
    joint.position.set(pivot[0], pivot[1], pivot[2]);
    parent.add(joint);

    const limb = mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    limb.position.y = offsetY;
    joint.add(limb);

    if (boot) {
      const foot = mesh(new THREE.BoxGeometry(size[0] * 1.1, 0.14, size[2] * 1.5), boot);
      foot.position.set(0, offsetY - size[1] / 2 + 0.05, -0.03);
      joint.add(foot);
    }

    return { joint, mesh: limb };
  }

  // ------------------------------------------------------------- animation --

  _createViewState() {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      speed: 0,
      onGround: true,
      sprinting: false,
      moving: false,
    };
  }

  _syncFromPlayer(snap = false) {
    const state = this.player?.state;
    if (!state) return;
    const view = this.view;
    view.position.copy(state.position);
    view.velocity.copy(state.velocity);
    view.yaw = state.yaw;
    view.speed = state.speed;
    view.onGround = state.onGround;
    view.sprinting = state.sprinting;
    view.moving = state.moving;

    if (snap) {
      this.root.position.copy(view.position);
      this.model.rotation.y = view.yaw;
    }
  }

  update(dt) {
    // Resolved lazily: the camera may be registered after this view.
    this.player ??= this.game?.services.get('player');
    this.camera ??= this.game?.services.get('camera3p');
    if (!this.player?.state) return;
    this._syncFromPlayer(false);
    this._animate(dt);
    this._updateVisibility();
  }

  _animate(dt) {
    const view = this.view;

    this.root.position.copy(view.position);
    this.model.rotation.y = dampAngle(this.model.rotation.y, view.yaw, 14, dt);

    const speedRatio = clamp(view.speed / 8.4, 0, 1.2);
    const targetWalk = view.onGround && view.moving && speedRatio > 0.05 ? 1 : 0;
    const targetAir = view.onGround ? 0 : 1;
    this.walkWeight = damp(this.walkWeight, targetWalk, 10, dt);
    this.airWeight = damp(this.airWeight, targetAir, 12, dt);

    // --- walk cycle ------------------------------------------------------
    const strideRate = 5.2 + speedRatio * 5.2;
    this.walkPhase += dt * strideRate * (0.35 + this.walkWeight * 0.65);
    const swing = Math.sin(this.walkPhase) * (0.3 + 0.42 * speedRatio) * this.walkWeight;

    // --- idle ------------------------------------------------------------
    const idleTime = (this._idleTime = (this._idleTime ?? 0) + dt);
    const breathe = Math.sin(idleTime * 1.6) * 0.02 * (1 - this.walkWeight);
    const idleArm = Math.sin(idleTime * 1.4) * 0.05 * (1 - this.walkWeight);

    // Aiming steadies the upper body: the weapon has to point where the player
    // is aiming, so the arm swing is damped out as the aim blend rises.
    const aim = this.downed ? 0 : this.combat?.aimBlend ?? 0;
    const armSteady = 1 - aim * 0.85;

    // --- airborne --------------------------------------------------------
    const airborne = this.airWeight;
    const rising = clamp(view.velocity.y / 7, -1, 1);

    this.legs.left.joint.rotation.x = -swing + airborne * (-0.45 - rising * 0.2);
    this.legs.right.joint.rotation.x = swing + airborne * (0.35 + rising * 0.15);
    this.arms.left.joint.rotation.x =
      (swing * 0.9 + idleArm) * armSteady + airborne * (-0.5 - rising * 0.5);
    this.arms.right.joint.rotation.x =
      (-swing * 0.9 - idleArm) * armSteady - aim * 1.15 + airborne * (-0.5 - rising * 0.5);
    this.arms.left.joint.rotation.z = 0.06 + airborne * 0.35;
    this.arms.right.joint.rotation.z = -0.06 - airborne * 0.35 + aim * 0.3;

    // --- torso lean + vertical bob ---------------------------------------
    const lean = speedRatio * 0.14 * this.walkWeight * (1 - aim) + airborne * 0.1;
    this.hips.rotation.x = lean;
    this.neck.rotation.x = -lean * 0.7;

    // --- elimination: the body drops -------------------------------------
    const tilt = this.downed ? -Math.PI / 2 : 0;
    this.model.rotation.x = damp(this.model.rotation.x, tilt, 6, dt);

    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.045 * this.walkWeight;

    // Landing compression / jump stretch, decaying over a few frames.
    this._jumpBounce = Math.max(0, (this._jumpBounce ?? 0) - dt);
    this._landBounce = Math.max(0, (this._landBounce ?? 0) - dt * 2.5);
    const squash = this._landBounce * -1 + this._jumpBounce * 0.5;

    this.model.position.y = bob + breathe + squash;
    this.model.scale.y = 1 + this._jumpBounce * 0.6 - this._landBounce * 0.8;
    this.model.scale.x = 1 - this._jumpBounce * 0.25 + this._landBounce * 0.35;
    this.model.scale.z = this.model.scale.x;
  }

  /** Hide the avatar when the camera is pushed into it. */
  _updateVisibility() {
    const distance = this.camera?.currentDistance;
    this.root.visible = distance === undefined || distance > 1.6;
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
    this.root.parent?.remove(this.root);
    this.root.traverse((child) => child.geometry?.dispose?.());
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}

const HIP_HEIGHT = 0.92;

const DEFAULT_COLORS = {
  jacket: '#2f6f6a',
  skin: '#c8935f',
  pants: '#37414b',
  boots: '#22262b',
  pack: '#5a4a33',
  accent: '#4ef0c8',
};

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
