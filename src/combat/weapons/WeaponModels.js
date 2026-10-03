import * as THREE from 'three';
import { getSurfacePack } from '../../render/ProceduralTextures.js';

/**
 * Procedural weapon models.
 *
 * The foundation ships without external assets, so weapons are built from
 * primitives. Each builder returns a group whose local space is:
 *
 *   -X = left, +X = right, +Y = up, -Z = forward (muzzle direction)
 *   origin = the grip, i.e. where the hand attaches
 *
 * and must expose a child named `muzzle` at the barrel tip: the combat system
 * reads its world position for tracers, muzzle flashes and the shot origin.
 *
 * Swapping in a glTF weapon later only means returning a loaded scene graph from
 * `builders[model]` with the same `muzzle` node.
 */
const builders = {
  rifle: buildRifle,
};

export function createWeaponModel(modelId = 'rifle') {
  const builder = builders[modelId];
  if (!builder) throw new Error(`Unknown weapon model "${modelId}"`);
  return builder();
}

export const weaponModelNames = Object.keys(builders);

// ---------------------------------------------------------------------------

function buildRifle() {
  const pbr = (material, kind) => {
    try {
      const pack = getSurfacePack(kind, 256);
      material.map = pack.map;
      material.normalMap = pack.normalMap;
      material.roughnessMap = pack.roughnessMap;
      material.envMapIntensity = 0.9;
    } catch { /* optional */ }
    return material;
  };
  const materials = {
    body: pbr(new THREE.MeshStandardMaterial({ color: '#3a4046', roughness: 0.42, metalness: 0.55 }), 'metal'),
    dark: pbr(new THREE.MeshStandardMaterial({ color: '#1a1e22', roughness: 0.62, metalness: 0.28 }), 'metal'),
    polymer: pbr(new THREE.MeshStandardMaterial({ color: '#2a2e32', roughness: 0.78, metalness: 0.08 }), 'asphalt'),
    accent: new THREE.MeshStandardMaterial({
      color: '#2f6f6a',
      roughness: 0.5,
      metalness: 0.3,
      emissive: new THREE.Color('#123a36'),
      emissiveIntensity: 0.35,
    }),
  };

  const group = new THREE.Group();
  group.name = 'weapon-rifle';

  const add = (geometry, material, position, name = 'part') => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(0.065, 0.105, 0.46), materials.body, [0, 0.01, -0.16], 'receiver');
  add(new THREE.BoxGeometry(0.058, 0.055, 0.36), materials.dark, [0, -0.01, -0.5], 'handguard');
  add(new THREE.BoxGeometry(0.04, 0.018, 0.42), materials.dark, [0, 0.07, -0.22], 'rail');
  const barrel = add(new THREE.CylinderGeometry(0.013, 0.013, 0.38, 12), materials.body, [0, 0.012, -0.82], 'barrel');
  barrel.rotation.x = Math.PI / 2;
  const brake = add(new THREE.CylinderGeometry(0.022, 0.02, 0.06, 12), materials.body, [0, 0.012, -1.0], 'brake');
  brake.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.08, 0.035, 0.08), materials.polymer, [0, -0.055, 0.04], 'trigger-guard');
  // Magazine, angled forward like a real AR.
  const magazine = add(new THREE.BoxGeometry(0.045, 0.19, 0.09), materials.dark, [0, -0.14, -0.12], 'magazine');
  magazine.rotation.x = -0.18;
  // Pistol grip + stock.
  const grip = add(new THREE.BoxGeometry(0.05, 0.13, 0.06), materials.body, [0, -0.11, 0.06], 'grip');
  grip.rotation.x = 0.32;
  add(new THREE.BoxGeometry(0.05, 0.09, 0.2), materials.body, [0, 0.01, 0.2], 'stock');
  // Optic + status light.
  add(new THREE.BoxGeometry(0.04, 0.05, 0.12), materials.dark, [0, 0.09, -0.16], 'optic');
  const light = add(new THREE.BoxGeometry(0.02, 0.02, 0.02), materials.accent, [0.04, 0.03, -0.3], 'status');

  // Muzzle node: the combat system reads its world transform every shot.
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.012, -1.04);
  group.add(muzzle);

  // Grip target for the articulated support hand; CombatSystem keeps this
  // foregrip aligned as the weapon blends between carry and ADS poses.
  const supportGrip = new THREE.Object3D();
  supportGrip.name = 'support-grip';
  supportGrip.position.set(-0.12, -0.025, -0.3);
  group.add(supportGrip);

  group.userData.muzzle = muzzle;
  group.userData.materials = Object.values(materials);
  group.userData.tracerColor = 0xffe6a8;
  group.userData.muzzleFlashColor = 0xffcf7a;
  group.userData.modelId = 'rifle';
  group.userData.emissiveMeshes = [light];
  return group;
}
