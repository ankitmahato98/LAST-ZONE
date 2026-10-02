import * as THREE from 'three';

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
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: '#33383d', roughness: 0.55, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1c2024', roughness: 0.7, metalness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({
      color: '#2f6f6a',
      roughness: 0.5,
      metalness: 0.3,
      emissive: new THREE.Color('#123a36'),
      emissiveIntensity: 0.5,
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

  // Receiver + handguard.
  add(new THREE.BoxGeometry(0.07, 0.11, 0.44), materials.body, [0, 0, -0.16], 'receiver');
  add(new THREE.BoxGeometry(0.06, 0.06, 0.34), materials.dark, [0, -0.005, -0.48], 'handguard');
  // Barrel + muzzle brake.
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), materials.dark, [0, 0.005, -0.78], 'barrel');
  const brake = add(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10), materials.body, [0, 0.005, -0.92], 'brake');
  brake.rotation.x = Math.PI / 2;
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
  muzzle.position.set(0, 0.005, -0.96);
  group.add(muzzle);

  group.userData.muzzle = muzzle;
  group.userData.materials = Object.values(materials);
  group.userData.tracerColor = 0xffe6a8;
  group.userData.muzzleFlashColor = 0xffcf7a;
  group.userData.modelId = 'rifle';
  group.userData.emissiveMeshes = [light];
  return group;
}
