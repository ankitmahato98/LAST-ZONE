import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle } from '../utils/math.js';

/**
 * Original low-poly field-operative avatar, built from a compact articulated
 * rig so it needs no remote asset and stays cheap on mobile GPUs. The view only
 * reads the simulation pawn; its legs, arms, breathing, landing and rifle pose
 * are driven from the live movement/combat state.
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
    this.downed = false;
    this._leftIkShoulder = new THREE.Quaternion();
    this._leftIkElbow = new THREE.Quaternion();
    this._leftIkHand = new THREE.Quaternion();
    this._rightCombined = new THREE.Quaternion();
    this._tmpWorld = new THREE.Vector3();
    this._tmpLocal = new THREE.Vector3();
  }

  init(game) {
    this.game = game;
    const renderer = game.services.require('renderer');
    this._buildBody();
    renderer.actorsGroup.add(this.root);

    this.player = game.services.get('player');
    this.camera = game.services.get('camera3p');
    this.combat = game.services.get('combat');
    this.view = this._createViewState();
    this._syncFromPlayer(true);

    this.player?.controller?.events.on('jump', () => this._onJump());
    this.player?.controller?.events.on('land', (payload) => this._onLand(payload));
    this._unsubscribe = [
      game.bus.on('combat:player:eliminated', () => { this.downed = true; }),
    ];
  }

  _buildBody() {
    const c = this.colors;
    const material = (color, roughness = 0.78, metalness = 0.04, emissive = null) => {
      const options = { color, roughness, metalness };
      if (emissive) {
        options.emissive = new THREE.Color(emissive);
        options.emissiveIntensity = 0.22;
      }
      const result = new THREE.MeshStandardMaterial(options);
      this.materials.push(result);
      return result;
    };

    this.materialsByName = {
      jacket: material(c.jacket, 0.83, 0.04),
      armor: material(c.armor, 0.62, 0.16),
      pants: material(c.pants, 0.92, 0.01),
      boots: material(c.boots, 0.76, 0.08),
      skin: material(c.skin, 0.86, 0),
      helmet: material(c.helmet, 0.6, 0.22),
      pack: material(c.pack, 0.85, 0.06),
      strap: material(c.strap, 0.9, 0.01),
      glove: material(c.glove, 0.8, 0.02),
      metal: material(c.metal, 0.42, 0.55),
      visor: material(c.visor, 0.32, 0.3, '#153d40'),
      accent: material(c.accent, 0.38, 0.28, '#123b36'),
    };

    this.model = new THREE.Group();
    this.model.name = `${this.modelName}-model`;
    this.root.add(this.model);

    this.hips = new THREE.Group();
    this.hips.position.y = HIP_HEIGHT;
    this.model.add(this.hips);

    const materials = this.materialsByName;
    this.torso = new THREE.Group();
    this.hips.add(this.torso);

    const torsoShell = part(new THREE.CapsuleGeometry(0.205, 0.18, 3, 10), materials.jacket);
    torsoShell.scale.set(1.08, 1.02, 0.72);
    torsoShell.position.y = 0.29;
    this.torso.add(torsoShell);

    addBox(this.torso, [0.38, 0.29, 0.105], [0, 0.36, -0.155], materials.armor, 'chest-plate');
    addBox(this.torso, [0.32, 0.07, 0.105], [0, 0.14, -0.16], materials.strap, 'lower-chest-rig');
    addBox(this.torso, [0.075, 0.42, 0.055], [-0.135, 0.35, -0.2], materials.strap, 'left-harness');
    addBox(this.torso, [0.075, 0.42, 0.055], [0.135, 0.35, -0.2], materials.strap, 'right-harness');
    addBox(this.torso, [0.45, 0.09, 0.3], [0, 0.005, 0], materials.metal, 'belt-frame');
    addBox(this.torso, [0.12, 0.11, 0.09], [0, 0.012, -0.17], materials.accent, 'buckle');
    for (const side of [-1, 1]) {
      addBox(this.torso, [0.12, 0.15, 0.12], [side * 0.17, 0.11, -0.12], materials.pack, 'utility-pouch');
      const pad = part(new THREE.SphereGeometry(0.14, 10, 8), materials.armor);
      pad.scale.set(1.1, 0.68, 1.08);
      pad.position.set(side * 0.3, 0.49, 0);
      this.hips.add(pad);
      addBox(this.torso, [0.1, 0.18, 0.1], [side * 0.1, -0.12, -0.13], materials.strap, 'radio-magazine');
    }

    // Compact rear rucksack with visible webbing and a rolled field blanket.
    addBox(this.torso, [0.34, 0.42, 0.18], [0, 0.31, 0.205], materials.pack, 'field-pack');
    addBox(this.torso, [0.36, 0.09, 0.21], [0, 0.12, 0.22], materials.strap, 'pack-lash');
    const blanket = part(new THREE.CylinderGeometry(0.075, 0.075, 0.31, 8), materials.strap);
    blanket.rotation.z = Math.PI / 2;
    blanket.position.set(0, 0.58, 0.28);
    this.torso.add(blanket);
    mergeStaticMeshes(this.torso);

    const neckBase = part(new THREE.CylinderGeometry(0.075, 0.09, 0.14, 10), materials.skin);
    neckBase.position.set(0, 0.62, 0);
    this.hips.add(neckBase);
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.72, 0);
    this.hips.add(this.neck);
    const face = part(new THREE.SphereGeometry(0.155, 12, 10), materials.skin);
    face.scale.set(0.88, 1.06, 0.94);
    face.position.y = 0.08;
    this.neck.add(face);
    const helmet = part(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.63), materials.helmet);
    helmet.position.y = 0.12;
    this.neck.add(helmet);
    addBox(this.neck, [0.28, 0.055, 0.065], [0, 0.09, -0.139], materials.visor, 'visor');
    addBox(this.neck, [0.3, 0.035, 0.045], [0, 0.02, -0.148], materials.metal, 'visor-rim');
    for (const side of [-1, 1]) {
      const ear = part(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), materials.metal);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(side * 0.17, 0.07, 0.015);
      this.neck.add(ear);
    }
    const helmetBand = part(new THREE.TorusGeometry(0.174, 0.014, 5, 12, Math.PI), materials.accent);
    helmetBand.rotation.set(Math.PI / 2, 0, Math.PI);
    helmetBand.position.set(0, 0.105, 0);
    this.neck.add(helmetBand);
    mergeStaticMeshes(this.neck);

    this.arms = {
      left: this._buildArm(-1),
      right: this._buildArm(1),
    };
    this.legs = {
      left: this._buildLeg(-1),
      right: this._buildLeg(1),
    };
    // Combine static details that share a rig joint/material into a few
    // lightweight draws while leaving animated joints independently posed.
    mergeStaticMeshes(this.hips);

    this.root.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
    });
  }

  _buildArm(side) {
    const materials = this.materialsByName;
    const shoulder = new THREE.Group();
    shoulder.position.set(side < 0 ? -0.22 : 0.29, 0.48, side < 0 ? -0.22 : 0);
    this.hips.add(shoulder);

    const upper = part(new THREE.CapsuleGeometry(0.074, 0.22, 2, 8), materials.jacket);
    upper.position.y = -0.135;
    shoulder.add(upper);
    const upperBand = part(new THREE.CylinderGeometry(0.078, 0.078, 0.055, 8), materials.strap);
    upperBand.position.y = -0.07;
    shoulder.add(upperBand);

    const elbow = new THREE.Group();
    elbow.position.y = -ARM_UPPER_LENGTH;
    shoulder.add(elbow);
    const forearm = part(new THREE.CapsuleGeometry(0.067, 0.21, 2, 8), materials.jacket);
    forearm.position.y = -0.135;
    elbow.add(forearm);
    const bracer = part(new THREE.BoxGeometry(0.12, 0.22, 0.09), materials.armor);
    bracer.position.set(0, -0.17, -0.047);
    elbow.add(bracer);
    const cuff = part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), materials.strap);
    cuff.position.y = -0.075;
    elbow.add(cuff);

    const hand = new THREE.Group();
    hand.position.y = -ARM_FOREARM_LENGTH;
    elbow.add(hand);
    const palm = part(new THREE.SphereGeometry(0.078, 9, 7), materials.glove);
    palm.scale.set(0.82, 0.78, 1.08);
    hand.add(palm);
    const thumb = part(new THREE.CapsuleGeometry(0.022, 0.055, 1, 6), materials.glove);
    thumb.rotation.z = side * 0.55;
    thumb.position.set(side * -0.052, -0.01, -0.03);
    hand.add(thumb);

    mergeStaticMeshes(shoulder);
    mergeStaticMeshes(elbow);
    mergeStaticMeshes(hand);
    return { joint: shoulder, elbow, hand };
  }

  _buildLeg(side) {
    const materials = this.materialsByName;
    const joint = new THREE.Group();
    joint.position.set(side * 0.115, 0, 0);
    this.hips.add(joint);

    const thigh = part(new THREE.CapsuleGeometry(0.097, 0.27, 2, 8), materials.pants);
    thigh.position.y = -0.22;
    joint.add(thigh);
    const thighPanel = part(new THREE.BoxGeometry(0.12, 0.23, 0.07), materials.armor);
    thighPanel.position.set(0, -0.21, -0.082);
    joint.add(thighPanel);

    const knee = new THREE.Group();
    knee.position.y = -LEG_UPPER_LENGTH;
    joint.add(knee);
    const shin = part(new THREE.CapsuleGeometry(0.074, 0.25, 2, 8), materials.pants);
    shin.position.y = -0.19;
    knee.add(shin);
    const shinGuard = part(new THREE.BoxGeometry(0.13, 0.28, 0.065), materials.armor);
    shinGuard.position.set(0, -0.18, -0.07);
    knee.add(shinGuard);
    const boot = part(new THREE.BoxGeometry(0.19, 0.14, 0.31), materials.boots);
    boot.position.set(0, -0.4, -0.055);
    knee.add(boot);
    const sole = part(new THREE.BoxGeometry(0.195, 0.035, 0.315), materials.metal);
    sole.position.set(0, -0.475, -0.055);
    knee.add(sole);
    mergeStaticMeshes(joint);
    mergeStaticMeshes(knee);
    return { joint, knee };
  }

  _onJump() { this._jumpBounce = 0.13; }

  _onLand(payload) {
    this._landBounce = clamp((payload?.speed ?? 0) / 14, 0, 0.3);
  }

  _createViewState() {
    return {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0,
      speed: 0, onGround: true, sprinting: false, moving: false,
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
    this.player ??= this.game?.services.get('player');
    this.camera ??= this.game?.services.get('camera3p');
    this.combat ??= this.game?.services.get('combat');
    if (!this.player?.state) return;
    this._syncFromPlayer(false);
    this._animate(dt);
    this._alignSupportHand();
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

    const strideRate = 5.2 + speedRatio * 5.2;
    this.walkPhase += dt * strideRate * (0.35 + this.walkWeight * 0.65);
    const swing = Math.sin(this.walkPhase) * (0.26 + 0.38 * speedRatio) * this.walkWeight;
    const idleTime = (this._idleTime = (this._idleTime ?? 0) + dt);
    const breathe = Math.sin(idleTime * 1.6) * 0.018 * (1 - this.walkWeight);
    const idleArm = Math.sin(idleTime * 1.4) * 0.035 * (1 - this.walkWeight);
    const aim = this.downed ? 0 : this.combat?.aimBlend ?? 0;
    const airborne = this.airWeight;
    const rising = clamp(view.velocity.y / 7, -1, 1);

    this.legs.left.joint.rotation.x = -swing + airborne * (-0.38 - rising * 0.16);
    this.legs.right.joint.rotation.x = swing + airborne * (0.3 + rising * 0.13);
    this.legs.left.knee.rotation.x = Math.max(0, swing) * 0.48 + airborne * 0.55;
    this.legs.right.knee.rotation.x = Math.max(0, -swing) * 0.48 + airborne * 0.42;

    const rightShoulderX = 0.12 + aim * 0.98 - swing * 0.12 + airborne * (-0.38 - rising * 0.32);
    const rightElbowX = -0.08 - aim * 0.12 + airborne * 0.12;
    this.arms.right.joint.rotation.set(rightShoulderX, 0, -0.035 + idleArm * 0.25);
    this.arms.right.elbow.rotation.set(rightElbowX, 0, 0);
    this._rightCombined.copy(this.arms.right.joint.quaternion).multiply(this.arms.right.elbow.quaternion);
    this.arms.right.hand.quaternion.copy(this._rightCombined).invert();

    this.arms.left.joint.rotation.set(0.12 + aim * 0.35 + swing * 0.23 + airborne * -0.36, 0, 0.08 + aim * 0.24);
    this.arms.left.elbow.rotation.set(-0.1 + aim * 0.18 + airborne * 0.1, 0, 0);
    this.arms.left.hand.rotation.set(-0.04, 0, 0);

    const lean = speedRatio * 0.11 * this.walkWeight * (1 - aim) + airborne * 0.075;
    this.hips.rotation.x = lean;
    this.neck.rotation.x = -lean * 0.65;

    this.model.rotation.x = damp(this.model.rotation.x, this.downed ? -Math.PI / 2 : 0, 6, dt);
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.04 * this.walkWeight;
    this._jumpBounce = Math.max(0, (this._jumpBounce ?? 0) - dt);
    this._landBounce = Math.max(0, (this._landBounce ?? 0) - dt * 2.5);
    const squash = this._landBounce * -1 + this._jumpBounce * 0.45;
    this.model.position.y = bob + breathe + squash;
    this.model.scale.y = 1 + this._jumpBounce * 0.55 - this._landBounce * 0.72;
    this.model.scale.x = 1 - this._jumpBounce * 0.22 + this._landBounce * 0.3;
    this.model.scale.z = this.model.scale.x;
  }

  /** Aim the support hand at the rifle's foregrip with a two-bone IK solve. */
  _alignSupportHand() {
    const aim = this.downed ? 0 : this.combat?.aimBlend ?? 0;
    const grip = this.combat?.weaponView?.model?.getObjectByName('support-grip');
    if (aim < 0.06 || !grip) return;

    this.root.updateMatrixWorld(true);
    grip.getWorldPosition(this._tmpWorld);
    this.hips.worldToLocal(this._tmpWorld);
    const shoulderPosition = this.arms.left.joint.position;
    this._tmpLocal.copy(this._tmpWorld).sub(shoulderPosition);
    const upper = ARM_UPPER_LENGTH;
    const lower = ARM_FOREARM_LENGTH;
    const distance = clamp(this._tmpLocal.length(), Math.abs(upper - lower) + 0.001, upper + lower - 0.002);
    const direction = this._tmpLocal.clone().normalize();
    const clampedTarget = direction.clone().multiplyScalar(distance);
    const pole = new THREE.Vector3(0, 0, -1);
    pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-5) pole.set(0, 1, 0).addScaledVector(direction, -direction.y);
    pole.normalize();

    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
    const elbowPosition = shoulderPosition.clone()
      .addScaledVector(direction, along)
      .addScaledVector(pole, bend);
    const firstDirection = elbowPosition.sub(shoulderPosition).normalize();
    const modelTarget = shoulderPosition.clone().add(clampedTarget);
    const elbowModel = shoulderPosition.clone().addScaledVector(firstDirection, upper);
    const secondDirection = modelTarget.sub(elbowModel).normalize();

    this._leftIkShoulder.setFromUnitVectors(DOWN, firstDirection);
    secondDirection.applyQuaternion(this._leftIkShoulder.clone().invert());
    this._leftIkElbow.setFromUnitVectors(DOWN, secondDirection.normalize());
    this._leftIkHand.copy(this._leftIkShoulder).multiply(this._leftIkElbow).invert();

    this.arms.left.joint.quaternion.slerp(this._leftIkShoulder, aim);
    this.arms.left.elbow.quaternion.slerp(this._leftIkElbow, aim);
    this.arms.left.hand.quaternion.slerp(this._leftIkHand, aim);
  }

  /** Combat calls this after posing the rifle so IK follows the current frame. */
  alignWeaponSupport() { this._alignSupportHand(); }

  _updateVisibility() {
    const distance = this.camera?.currentDistance;
    this.root.visible = distance === undefined || distance > 1.55;
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
const ARM_UPPER_LENGTH = 0.27;
const ARM_FOREARM_LENGTH = 0.27;
const LEG_UPPER_LENGTH = 0.42;
const DOWN = new THREE.Vector3(0, -1, 0);

const DEFAULT_COLORS = {
  jacket: '#344e50',
  armor: '#465c5c',
  pants: '#30383b',
  boots: '#20282b',
  skin: '#bb8c68',
  helmet: '#454d48',
  pack: '#514634',
  strap: '#272f30',
  glove: '#252a29',
  metal: '#68716e',
  visor: '#315560',
  accent: '#57b7a5',
};

function part(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addBox(parent, size, position, material, name = 'armor-detail') {
  const mesh = part(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function mergeStaticMeshes(parent) {
  const meshes = parent.children.filter((child) => child.isMesh);
  if (meshes.length < 2) return;

  const batches = new Map();
  for (const mesh of meshes) {
    const material = mesh.material;
    const geometries = batches.get(material) ?? [];
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    geometry.clearGroups();
    geometries.push(geometry);
    batches.set(material, geometries);
  }

  const mergedBatches = [];
  try {
    for (const [material, geometries] of batches) {
      if (geometries.length === 1) {
        mergedBatches.push({ material, geometry: geometries[0] });
        continue;
      }
      const geometry = mergeGeometries(geometries, false);
      if (!geometry) throw new Error('Incompatible character part geometry');
      mergedBatches.push({ material, geometry });
    }
  } catch {
    for (const geometries of batches.values()) {
      for (const geometry of geometries) geometry.dispose();
    }
    return;
  }

  for (const mesh of meshes) {
    parent.remove(mesh);
    mesh.geometry.dispose();
  }
  for (const [index, batch] of mergedBatches.entries()) {
    const mesh = part(batch.geometry, batch.material);
    mesh.name = `${parent.name || 'rig'}-batch-${index}`;
    parent.add(mesh);
  }
}
