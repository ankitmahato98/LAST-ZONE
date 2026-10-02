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
