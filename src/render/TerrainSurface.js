import * as THREE from 'three';
import { getSurfacePack } from './ProceduralTextures.js';

/**
 * Terrain PBR: vertex colours remain the biome macro-mask; repeating detail
 * maps add grass/dirt/rock/sand grain that lighting can catch.
 */
export function createTerrainMaterial(quality = {}) {
  const size = quality.textureSize ?? 256;
  const grass = getSurfacePack('grass', size);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grass.map,
    normalMap: grass.normalMap,
    roughnessMap: grass.roughnessMap,
    aoMap: grass.aoMap,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.28,
  });
  material.name = 'terrain-pbr';
  grass.map.repeat.set(180, 180);
  grass.normalMap.repeat.set(180, 180);
  grass.roughnessMap.repeat.set(180, 180);
  grass.aoMap.repeat.set(180, 180);
  material.normalScale = new THREE.Vector2(0.85, 0.85);

  if (quality.pbrMaps === false) {
    material.map = null;
    material.normalMap = null;
    material.roughnessMap = null;
    material.aoMap = null;
  }

  return material;
}
