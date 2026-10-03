import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY, getQualitySettings, detectProfile } from '../src/config/settings.js';
import { configureMaterials, getMaterial, disposeMaterials } from '../src/world/materials.js';
import { createTerrainMaterial } from '../src/render/TerrainSurface.js';
import { createWaterMaterial } from '../src/render/WaterSurface.js';
import { getSurfacePack, SURFACE_KINDS } from '../src/render/ProceduralTextures.js';
import { CHARACTER_GLB_URL, WEAPON_GLB_URL } from '../src/player/CharacterAssets.js';

test('quality tiers expose low/medium/high/ultra plus mobile/desktop aliases', () => {
  for (const name of ['low', 'medium', 'high', 'ultra', 'mobile', 'desktop']) {
    assert.ok(QUALITY[name], name);
    const q = getQualitySettings(name);
    assert.ok(q.terrainSegments > 0);
    assert.equal('pbrMaps' in q, true);
    assert.equal('postFx' in q, true);
  }
  assert.equal(getQualitySettings('mobile').trees, getQualitySettings('medium').trees);
  assert.equal(getQualitySettings('desktop').shadowMapSize, getQualitySettings('high').shadowMapSize);
  assert.ok(getQualitySettings('ultra').trees > getQualitySettings('high').trees);
});

test('detectProfile still accepts legacy mobile/desktop query values', () => {
  assert.ok(['mobile', 'desktop', 'low', 'medium', 'high', 'ultra'].includes(detectProfile()));
});

test('procedural PBR packs exist for every authored surface kind', () => {
  configureMaterials({ pbr: true, size: 32 });
  for (const kind of SURFACE_KINDS) {
    const pack = getSurfacePack(kind, 32);
    assert.ok(pack.map);
    assert.ok(pack.normalMap);
    assert.ok(pack.roughnessMap);
  }
});

test('shared materials receive maps when PBR is enabled', () => {
  disposeMaterials();
  configureMaterials({ pbr: true, size: 32 });
  const brick = getMaterial('brickWarm');
  assert.ok(brick.map, 'brick should sample a repeating albedo');
  assert.ok(brick.normalMap);
  disposeMaterials();
  configureMaterials({ pbr: false, size: 32 });
  const plain = getMaterial('brickWarm');
  assert.ok(!plain.map);
  disposeMaterials();
  configureMaterials({ pbr: true, size: 256 });
});

test('terrain and water materials are named and tickable', () => {
  const terrain = createTerrainMaterial({ textureSize: 32, pbrMaps: true });
  assert.equal(terrain.name, 'terrain-pbr');
  assert.equal(terrain.vertexColors, true);
  const water = createWaterMaterial({ quality: { waterWaves: true } });
  assert.equal(water.name, 'water-surface');
  const before = water.uniforms.uTime.value;
  water.userData.update(0.16);
  assert.ok(water.uniforms.uTime.value > before);
  terrain.dispose();
  water.dispose();
});

test('character/weapon GLB slots are documented original-asset paths, not marketplace rips', () => {
  assert.equal(CHARACTER_GLB_URL, '/assets/characters/operative.glb');
  assert.equal(WEAPON_GLB_URL, '/assets/weapons/ar4-ranger.glb');
  assert.equal(CHARACTER_GLB_URL.includes('freefire'), false);
});
