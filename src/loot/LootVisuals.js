import * as THREE from 'three';

/**
 * Instanced world models for loot pickups.
 *
 * Rendering budget is the whole point of this file: a 4 km island carries a few
 * hundred pickups, and a few hundred unique meshes would shred a phone GPU. Each
 * `visual` is therefore a *list of parts*; the loot system builds exactly one
 * `InstancedMesh` per part for the whole map, and every pickup of that visual
 * just occupies an instance slot.
 *
 * Part offsets/rotations/scales are baked into the geometry at build time, so
 * the per-instance matrix only carries the pickup's position, yaw and its bob -
 * which keeps the per-frame instance writes to one matrix per pickup.
 */

const LAYER = {
  crate: 0x2d3a42,
  crateTop: 0x465a63,
  accent: 0x4ef0c8,
  ammoBox: 0x6b5a2c,
  ammoLid: 0xd8a13c,
  stem: 0xd9cbb0,
  cap: 0xb64a36,
  body: 0x35505c,
  glass: 0x8fdfef,
  marker: 0x4ef0c8,
};

let materials = null;
let geometries = null;

function buildMaterials() {
  const standard = (color, options = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.25, ...options });
  return {
    crate: standard(LAYER.crate, { roughness: 0.75 }),
    crateTop: standard(LAYER.crateTop, { roughness: 0.6, metalness: 0.35 }),
    accent: standard(LAYER.accent, {
      roughness: 0.4,
      metalness: 0.1,
      emissive: new THREE.Color(LAYER.accent),
      emissiveIntensity: 0.35,
    }),
    ammoBox: standard(LAYER.ammoBox, { roughness: 0.8 }),
    ammoLid: standard(LAYER.ammoLid, { roughness: 0.55, metalness: 0.3 }),
    stem: standard(LAYER.stem, { roughness: 0.95, metalness: 0 }),
    cap: standard(LAYER.cap, { roughness: 0.85, metalness: 0 }),
    body: standard(LAYER.body, { roughness: 0.5, metalness: 0.4 }),
    glass: standard(LAYER.glass, {
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
      emissive: new THREE.Color(LAYER.glass),
      emissiveIntensity: 0.4,
    }),
    marker: new THREE.MeshBasicMaterial({
      color: LAYER.marker,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
}

/** A part descriptor: a primitive plus a local transform baked into geometry. */
function part(geometry, material, { position = [0, 0, 0], rotation = [0, 0, 0], scale = null } = {}) {
  return { geometry, material, position, rotation, scale };
}

const VISUAL_BUILDERS = {
  weapon: (m) => [
    part(new THREE.BoxGeometry(0.92, 0.2, 0.44), m.crate, { position: [0, 0.11, 0] }),
    part(new THREE.BoxGeometry(0.86, 0.06, 0.38), m.crateTop, { position: [0, 0.23, 0] }),
    part(new THREE.BoxGeometry(0.4, 0.05, 0.1), m.accent, { position: [0, 0.27, 0] }),
    part(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), m.marker, { position: [0, 1.0, 0] }),
  ],
  'ammo-box': (m) => [
    part(new THREE.BoxGeometry(0.5, 0.26, 0.34), m.ammoBox, { position: [0, 0.14, 0] }),
    part(new THREE.BoxGeometry(0.52, 0.07, 0.36), m.ammoLid, { position: [0, 0.3, 0] }),
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), m.marker, { position: [0, 0.7, 0] }),
  ],
  mushroom: (m) => [
    part(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 8), m.stem, { position: [0, 0.1, 0] }),
    part(new THREE.SphereGeometry(0.19, 10, 7), m.cap, { position: [0, 0.22, 0], scale: [1, 0.72, 1] }),
    part(new THREE.SphereGeometry(0.05, 6, 5), m.stem, { position: [0.09, 0.26, 0.05] }),
    part(new THREE.SphereGeometry(0.04, 6, 5), m.stem, { position: [-0.08, 0.25, -0.07] }),
  ],
  inhaler: (m) => [
    part(new THREE.BoxGeometry(0.16, 0.34, 0.11), m.body, { position: [0, 0.18, 0] }),
    part(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 8), m.glass, { position: [0, 0.4, 0] }),
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), m.marker, { position: [0, 0.62, 0] }),
  ],
  'armor-plate': (m) => [
    part(new THREE.BoxGeometry(0.42, 0.5, 0.1), m.body, { position: [0, 0.28, 0] }),
    part(new THREE.BoxGeometry(0.3, 0.16, 0.05), m.accent, { position: [0, 0.34, 0.06] }),
  ],
  attachment: (m) => [
    part(new THREE.BoxGeometry(0.2, 0.1, 0.28), m.body, { position: [0, 0.1, 0] }),
    part(new THREE.BoxGeometry(0.08, 0.08, 0.32), m.ammoLid, { position: [0, 0.17, 0] }),
  ],
  cosmetic: (m) => [
    part(new THREE.OctahedronGeometry(0.15), m.glass, { position: [0, 0.18, 0] }),
    part(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), m.accent, { position: [0, 0.45, 0] }),
  ],
  crate: (m) => [part(new THREE.BoxGeometry(0.5, 0.36, 0.5), m.crate, { position: [0, 0.19, 0] })],
};

/** Build (once) and return `{ [visualId]: { parts: [...] } }`. */
export function createLootVisuals() {
  if (materials && geometries) return geometries;
  materials = buildMaterials();
  geometries = {};
  for (const [id, builder] of Object.entries(VISUAL_BUILDERS)) {
    const parts = builder(materials).map((descriptor) => {
      const geometry = descriptor.geometry;
      const scale = descriptor.scale ?? [1, 1, 1];
      geometry.scale(scale[0], scale[1], scale[2]);
      if (descriptor.rotation.some((value) => value !== 0)) {
        geometry.rotateX(descriptor.rotation[0]);
        geometry.rotateY(descriptor.rotation[1]);
        geometry.rotateZ(descriptor.rotation[2]);
      }
      geometry.translate(...descriptor.position);
      geometry.computeBoundingSphere();
      return { geometry, material: descriptor.material };
    });
    geometries[id] = { id, parts };
  }
  return geometries;
}

export function getLootVisual(id) {
  const visuals = createLootVisuals();
  return visuals[id] ?? visuals.crate;
}

export function listLootVisualIds() {
  return Object.keys(createLootVisuals());
}

export function disposeLootVisuals() {
  if (!geometries || !materials) return;
  for (const visual of Object.values(geometries)) {
    for (const partGeometry of visual.parts) partGeometry.geometry.dispose();
  }
  for (const material of Object.values(materials)) material.dispose();
  geometries = null;
  materials = null;
}
