import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Production character pipeline.
 *
 * Drop an original, commercially licensed GLB at
 * `public/assets/characters/operative.glb` with:
 *   - human-scale skeleton (hips/spine/head/arms/legs)
 *   - named nodes `RightHand`, `LeftHand`, `support-grip` optional
 *   - metres, Y-up, origin at feet
 *
 * Until that file exists this loader returns null and CharacterView keeps
 * the original procedural field-operative. No third-party game rips.
 */
export const CHARACTER_GLB_URL = '/assets/characters/operative.glb';
export const WEAPON_GLB_URL = '/assets/weapons/ar4-ranger.glb';

const loader = typeof GLTFLoader === 'function' ? new GLTFLoader() : null;

export async function loadOptionalGltf(url) {
  if (!loader || typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return null;
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) child.material.envMapIntensity = 0.7;
        });
        resolve(gltf);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export function findBone(root, names) {
  let found = null;
  root.traverse((node) => {
    if (found) return;
    if (names.includes(node.name)) found = node;
  });
  return found;
}

export function applyIdleMixer(gltf) {
  if (!gltf?.animations?.length) return null;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = gltf.animations[0];
  mixer.clipAction(clip).play();
  return mixer;
}
