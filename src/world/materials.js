import * as THREE from 'three';
import { getSurfacePack } from '../render/ProceduralTextures.js';

/**
 * Shared PBR material library. Surfaces pull original procedural maps so
 * lighting, normals and roughness are consistent across buildings, props
 * and vegetation without shipping third-party texture packs.
 */
const cache = new Map();
let pbrEnabled = true;
let textureSize = 256;

export function configureMaterials({ pbr = true, size = 256 } = {}) {
  pbrEnabled = pbr;
  textureSize = size;
}

function applyPack(material, kind, repeat = 2) {
  if (!pbrEnabled) return material;
  const pack = getSurfacePack(kind, textureSize);
  material.map = pack.map;
  material.normalMap = pack.normalMap;
  material.roughnessMap = pack.roughnessMap;
  material.map.repeat.set(repeat, repeat);
  material.normalMap.repeat.set(repeat, repeat);
  material.roughnessMap.repeat.set(repeat, repeat);
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  material.envMapIntensity = material.metalness > 0.2 ? 0.85 : 0.35;
  return material;
}

function standard(params, pack = null, repeat = 2) {
  const material = new THREE.MeshStandardMaterial(params);
  if (pack) applyPack(material, pack, repeat);
  return material;
}

const factories = {
  concrete: () => standard({ color: '#9a9a92', roughness: 0.9, metalness: 0.05 }, 'concrete', 3),
  concreteDark: () => standard({ color: '#6c6c67', roughness: 0.92, metalness: 0.05 }, 'concrete', 3),
  metal: () => standard({ color: '#5a646c', roughness: 0.45, metalness: 0.65 }, 'metal', 2),
  metalPainted: () => standard({ color: '#2f5f66', roughness: 0.6, metalness: 0.35 }, 'metal', 2),
  crateWood: () => standard({ color: '#8a6a42', roughness: 0.85, metalness: 0.02 }, 'wood', 2),
  crateMetal: () => standard({ color: '#6a7b57', roughness: 0.55, metalness: 0.4 }, 'metal', 1.5),
  pad: () =>
    standard({
      color: '#243c44',
      roughness: 0.6,
      metalness: 0.2,
      emissive: new THREE.Color('#0d3b3a'),
      emissiveIntensity: 0.45,
    }, 'asphalt', 4),
  padMarking: () =>
    standard({
      color: '#4ef0c8',
      roughness: 0.5,
      metalness: 0.1,
      emissive: new THREE.Color('#1f8f7c'),
      emissiveIntensity: 0.55,
    }),
  rock: () => standard({ color: '#7a766d', roughness: 1, metalness: 0 }, 'rock', 2),
  bark: () => standard({ color: '#54402e', roughness: 1, metalness: 0 }, 'wood', 1.5),
  leaves: () => standard({ color: '#3f6b34', roughness: 1, metalness: 0 }, 'grass', 2),
  leavesDark: () => standard({ color: '#33552c', roughness: 1, metalness: 0 }, 'grass', 2),
  grass: () => standard({ color: '#5c7a3f', roughness: 1, metalness: 0, side: THREE.DoubleSide }, 'grass', 1),
  arrivalStone: () => standard({ color: '#646d69', roughness: 0.96, metalness: 0.02 }, 'rock', 2),
  brickWarm: () => standard({ color: '#86614e', roughness: 0.94, metalness: 0 }, 'brick', 3),
  stoneWarm: () => standard({ color: '#9a8d72', roughness: 0.98, metalness: 0 }, 'rock', 2),
  stoneCool: () => standard({ color: '#727b79', roughness: 0.96, metalness: 0.02 }, 'rock', 2),
  stuccoCream: () => standard({ color: '#c2b18a', roughness: 0.9, metalness: 0 }, 'concrete', 2),
  stuccoOchre: () => standard({ color: '#b18a4d', roughness: 0.92, metalness: 0 }, 'dirt', 2),
  harborWood: () => standard({ color: '#6f5540', roughness: 0.92, metalness: 0.02 }, 'wood', 2),
  forestTimber: () => standard({ color: '#524434', roughness: 0.96, metalness: 0 }, 'wood', 2),
  woodDark: () => standard({ color: '#3b3026', roughness: 0.92, metalness: 0.02 }, 'wood', 2),
  roofSlate: () => standard({ color: '#45545c', roughness: 0.86, metalness: 0.12 }, 'asphalt', 2),
  roofRed: () => standard({ color: '#8b4b3c', roughness: 0.88, metalness: 0.04 }, 'brick', 2),
  roofForest: () => standard({ color: '#344b3a', roughness: 0.94, metalness: 0 }, 'wood', 2),
  roofOlive: () => standard({ color: '#586048', roughness: 0.87, metalness: 0.08 }, 'metal', 2),
  roofMetal: () => standard({ color: '#647278', roughness: 0.58, metalness: 0.48 }, 'metal', 3),
  windowGlass: () => standard({
    color: '#426878', roughness: 0.18, metalness: 0.55,
    emissive: new THREE.Color('#0a1d25'), emissiveIntensity: 0.22, envMapIntensity: 1.1,
  }),
  doorDark: () => standard({ color: '#211f1a', roughness: 0.9, metalness: 0 }, 'wood', 1),
  sandbag: () => standard({ color: '#887d62', roughness: 0.97, metalness: 0 }, 'sand', 1.5),
  chimneyBrick: () => standard({ color: '#765348', roughness: 0.95, metalness: 0.02 }, 'brick', 2),
  warningRed: () => standard({ color: '#b34f3c', roughness: 0.72, metalness: 0.24 }, 'metal', 1),
  waterTank: () => standard({ color: '#5f8f89', roughness: 0.48, metalness: 0.3 }, 'metal', 2),
  bridgeWood: () => standard({ color: '#70563d', roughness: 0.9, metalness: 0.03 }, 'wood', 2),
  bridgeMetal: () => standard({ color: '#59666a', roughness: 0.52, metalness: 0.48 }, 'metal', 2),
  bridgeStone: () => standard({ color: '#77756c', roughness: 0.95, metalness: 0 }, 'rock', 2),
  mainRoad: () => standard({ color: '#353a3b', roughness: 0.94, metalness: 0.02, side: THREE.DoubleSide }, 'asphalt', 8),
  secondaryRoad: () => standard({ color: '#4b4a42', roughness: 0.98, metalness: 0, side: THREE.DoubleSide }, 'asphalt', 6),
  dirtRoad: () => standard({ color: '#796b4d', roughness: 1, metalness: 0, side: THREE.DoubleSide }, 'dirt', 6),
  footpath: () => standard({ color: '#999078', roughness: 0.99, metalness: 0, side: THREE.DoubleSide }, 'dirt', 4),
  ocean: () => standard({ color: '#2f7585', roughness: 0.18, metalness: 0.35, envMapIntensity: 1.2 }),
  river: () => standard({ color: '#438c99', roughness: 0.16, metalness: 0.32, side: THREE.DoubleSide, envMapIntensity: 1.1 }),
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
