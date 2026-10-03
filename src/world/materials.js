import * as THREE from 'three';

/**
 * Shared material library.
 *
 * Materials are the most expensive thing to duplicate: every unique instance is
 * another shader program. Anything reusable belongs here, keyed by name, so
 * future loot/weapon models can pull from the same palette instead of creating
 * their own.
 */
const cache = new Map();

function standard(params) {
  return new THREE.MeshStandardMaterial(params);
}

const factories = {
  concrete: () => standard({ color: '#9a9a92', roughness: 0.9, metalness: 0.05 }),
  concreteDark: () => standard({ color: '#6c6c67', roughness: 0.92, metalness: 0.05 }),
  metal: () => standard({ color: '#5a646c', roughness: 0.45, metalness: 0.65 }),
  metalPainted: () => standard({ color: '#2f5f66', roughness: 0.6, metalness: 0.35 }),
  crateWood: () => standard({ color: '#8a6a42', roughness: 0.85, metalness: 0.02 }),
  crateMetal: () => standard({ color: '#6a7b57', roughness: 0.55, metalness: 0.4 }),
  pad: () =>
    standard({
      color: '#243c44',
      roughness: 0.6,
      metalness: 0.2,
      emissive: new THREE.Color('#0d3b3a'),
      emissiveIntensity: 0.9,
    }),
  padMarking: () =>
    standard({
      color: '#4ef0c8',
      roughness: 0.5,
      metalness: 0.1,
      emissive: new THREE.Color('#1f8f7c'),
      emissiveIntensity: 1.1,
    }),
  rock: () => standard({ color: '#7a766d', roughness: 1, metalness: 0, flatShading: true }),
  bark: () => standard({ color: '#54402e', roughness: 1, metalness: 0 }),
  leaves: () => standard({ color: '#3f6b34', roughness: 1, metalness: 0, flatShading: true }),
  leavesDark: () => standard({ color: '#33552c', roughness: 1, metalness: 0, flatShading: true }),
  grass: () => standard({ color: '#5c7a3f', roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  arrivalStone: () => standard({ color: '#646d69', roughness: 0.96, metalness: 0.02 }),
  brickWarm: () => standard({ color: '#86614e', roughness: 0.94, metalness: 0 }),
  stoneWarm: () => standard({ color: '#9a8d72', roughness: 0.98, metalness: 0 }),
  stoneCool: () => standard({ color: '#727b79', roughness: 0.96, metalness: 0.02 }),
  stuccoCream: () => standard({ color: '#c2b18a', roughness: 0.9, metalness: 0 }),
  stuccoOchre: () => standard({ color: '#b18a4d', roughness: 0.92, metalness: 0 }),
  harborWood: () => standard({ color: '#6f5540', roughness: 0.92, metalness: 0.02 }),
  forestTimber: () => standard({ color: '#524434', roughness: 0.96, metalness: 0 }),
  woodDark: () => standard({ color: '#3b3026', roughness: 0.92, metalness: 0.02 }),
  roofSlate: () => standard({ color: '#45545c', roughness: 0.86, metalness: 0.12 }),
  roofRed: () => standard({ color: '#8b4b3c', roughness: 0.88, metalness: 0.04 }),
  roofForest: () => standard({ color: '#344b3a', roughness: 0.94, metalness: 0 }),
  roofOlive: () => standard({ color: '#586048', roughness: 0.87, metalness: 0.08 }),
  roofMetal: () => standard({ color: '#647278', roughness: 0.58, metalness: 0.48 }),
  windowGlass: () => standard({ color: '#426878', roughness: 0.3, metalness: 0.35, emissive: new THREE.Color('#0a1d25'), emissiveIntensity: 0.18 }),
  doorDark: () => standard({ color: '#211f1a', roughness: 0.9, metalness: 0 }),
  sandbag: () => standard({ color: '#887d62', roughness: 0.97, metalness: 0 }),
  chimneyBrick: () => standard({ color: '#765348', roughness: 0.95, metalness: 0.02 }),
  warningRed: () => standard({ color: '#b34f3c', roughness: 0.72, metalness: 0.24 }),
  waterTank: () => standard({ color: '#5f8f89', roughness: 0.48, metalness: 0.3 }),
  bridgeWood: () => standard({ color: '#70563d', roughness: 0.9, metalness: 0.03 }),
  bridgeMetal: () => standard({ color: '#59666a', roughness: 0.52, metalness: 0.48 }),
  bridgeStone: () => standard({ color: '#77756c', roughness: 0.95, metalness: 0 }),
  mainRoad: () => standard({ color: '#353a3b', roughness: 0.94, metalness: 0.02, side: THREE.DoubleSide }),
  secondaryRoad: () => standard({ color: '#4b4a42', roughness: 0.98, metalness: 0, side: THREE.DoubleSide }),
  dirtRoad: () => standard({ color: '#796b4d', roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  footpath: () => standard({ color: '#999078', roughness: 0.99, metalness: 0, side: THREE.DoubleSide }),
  ocean: () => standard({ color: '#2f7585', roughness: 0.3, metalness: 0.12 }),
  river: () => standard({ color: '#438c99', roughness: 0.28, metalness: 0.14, side: THREE.DoubleSide }),
};

export function getMaterial(name) {
  if (!cache.has(name)) {
    const factory = factories[name];
    if (!factory) throw new Error(`Unknown material "${name}"`);
    cache.set(name, factory());
  }
  return cache.get(name);
}

export function disposeMaterials() {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}

export const materialNames = Object.keys(factories);
