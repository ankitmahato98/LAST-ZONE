import * as THREE from 'three';
import { damp } from '../../utils/math.js';
import { createWeaponModel } from './WeaponModels.js';

/**
 * The visual half of a weapon: builds the model, attaches it to the character's
 * right hand and poses it.
 *
 * Pose is the interesting part. The combat system publishes aim/recoil (pure
 * numbers), this view converts them into a mounted position and rotation:
 *
 *   hip    - carried low and angled, barrel slightly outward
 *   aim    - pulled in, aligned with the camera ray through the shoulder
 *   recoil - the barrel kicks up/back and settles
 *
 * This is the file to replace when weapons get real animations (glTF + mixer):
 * everything above it talks in numbers, not bones.
 */
const HIP_POSE = {
  // The rifle sits in the right palm, carried low across the body.
  position: new THREE.Vector3(0.015, -0.025, 0.055),
  rotation: new THREE.Euler(-0.54, 0.02, 0.11),
};

const AIM_POSE = {
  // The right wrist is counter-rotated by the character rig, leaving the bore
  // level and parallel with the camera's forward axis while aiming.
  position: new THREE.Vector3(-0.1, 0.025, 0.2),
  rotation: new THREE.Euler(0, 0, 0),
};

export class WeaponView {
  /**
   * @param {import('./Weapon.js').Weapon} weapon
   * @param {{attachTo: THREE.Object3D}} options
   */
  constructor(weapon, { attachTo, quality = null } = {}) {
    this.weapon = weapon;
    this.quality = quality;
    this.aim = 0;
    this.recoil = 0;

    this.model = createWeaponModel(weapon.type.model);
    this.model.scale.setScalar(quality === 'mobile' ? 0.94 : 1);
    this.muzzle = this.model.userData.muzzle ?? this.model;

    /** Pivot so posed offsets apply around the grip, not the model origin. */
    this.pivot = new THREE.Group();
    this.pivot.name = 'weapon-pivot';
    this.pivot.add(this.model);

    this.root = new THREE.Group();
    this.root.name = 'weapon-mount';
    this.root.add(this.pivot);
    attachTo?.add(this.root);

    this._position = HIP_POSE.position.clone();
    this._rotation = HIP_POSE.rotation.clone();
    this._worldMuzzle = new THREE.Vector3();
    this.applyAim(0, { snap: true });
  }

  /** 0 = carried at the hip, 1 = fully aimed down the sight line. */
  applyAim(aim, { snap = false } = {}) {
    this.aim = snap ? aim : damp(this.aim, aim, 16, 1 / 60);
    return this.aim;
  }

  setRecoil(amount) {
    this.recoil = Math.min(amount, 1);
  }

  update(dt, { aiming = false, reloading = false, reloadProgress = 0, moving = false } = {}) {
    this.aim = damp(this.aim, aiming ? 1 : 0, 16, dt);
    this.recoil = damp(this.recoil, 0, 12, dt);

    const blend = this.aim;
    this._position.lerpVectors(HIP_POSE.position, AIM_POSE.position, blend);
    this._rotation.set(
      THREE.MathUtils.lerp(HIP_POSE.rotation.x, AIM_POSE.rotation.x, blend),
      THREE.MathUtils.lerp(HIP_POSE.rotation.y, AIM_POSE.rotation.y, blend),
      THREE.MathUtils.lerp(HIP_POSE.rotation.z, AIM_POSE.rotation.z, blend),
    );

    // Reload: dip the weapon and roll it towards the shooter.
    if (reloading) {
      const swing = Math.sin(reloadProgress * Math.PI);
      this._position.y -= swing * 0.14;
      this._rotation.z += swing * 0.5;
      this._rotation.x -= swing * 0.25;
    }

    // Walk sway, reduced while aiming.
    const sway = (1 - blend * 0.7) * 0.012;
    const time = (this._time = (this._time ?? 0) + dt);
    const bob = moving ? Math.sin(time * 9) * sway : Math.sin(time * 1.5) * sway * 0.3;
    this._position.y += bob;

    // Recoil kick: back and up, on the pivot so the muzzle rises.
    this._position.z += this.recoil * 0.07;
    this._rotation.x -= this.recoil * 0.35;

    this.pivot.position.copy(this._position);
    this.pivot.rotation.copy(this._rotation);
  }

  /** World-space muzzle tip, updated on demand (cheap: one matrix walk). */
  getWorldMuzzle(target = this._worldMuzzle) {
    this.muzzle.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.muzzle.matrixWorld);
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.model.traverse((child) => child.geometry?.dispose?.());
    for (const material of this.model.userData.materials ?? []) material.dispose();
  }
}
