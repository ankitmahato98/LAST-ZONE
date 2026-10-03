import * as THREE from 'three';

/**
 * Original, runtime-generated PBR maps. No third-party textures are bundled.
 * These are not photogrammetry — they give MeshStandardMaterial real
 * micro-detail (albedo grain, normals, roughness) so lighting can respond.
 */
const cache = new Map();

export function noise2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function fbm(x, y, octaves = 5) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    value += amp * noise2(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return value;
}

export function getSurfacePack(kind, size = 256) {
  const key = `${kind}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const pack = buildPack(kind, size);
  cache.set(key, pack);
  return pack;
}

export function disposeTexturePacks() {
  for (const pack of cache.values()) {
    pack.map?.dispose();
    pack.normalMap?.dispose();
    pack.roughnessMap?.dispose();
    pack.aoMap?.dispose();
  }
  cache.clear();
}

function buildPack(kind, size) {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const ao = new Uint8Array(size * size * 4);
  const palette = PALETTES[kind] ?? PALETTES.dirt;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const h = sampleHeight(kind, u, v);
      height[y * size + x] = h;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const h = height[i];
      const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x + size - 1) % size)];
      const hy = height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x];
      const nx = -hx * palette.normalScale;
      const ny = -hy * palette.normalScale;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o = i * 4;
      const mix = THREE.MathUtils.clamp(h, 0, 1);
      albedo[o] = lerpByte(palette.dark[0], palette.light[0], mix);
      albedo[o + 1] = lerpByte(palette.dark[1], palette.light[1], mix);
      albedo[o + 2] = lerpByte(palette.dark[2], palette.light[2], mix);
      albedo[o + 3] = 255;
      normal[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
      const r = THREE.MathUtils.clamp(palette.roughness + (h - 0.5) * palette.roughnessVar, 0.05, 0.98);
      rough[o] = rough[o + 1] = rough[o + 2] = Math.round(r * 255);
      rough[o + 3] = 255;
      const shade = THREE.MathUtils.clamp(0.55 + h * 0.45, 0.35, 1);
      ao[o] = ao[o + 1] = ao[o + 2] = Math.round(shade * 255);
      ao[o + 3] = 255;
    }
  }

  return {
    map: dataTexture(albedo, size, THREE.SRGBColorSpace),
    normalMap: dataTexture(normal, size, THREE.LinearSRGBColorSpace),
    roughnessMap: dataTexture(rough, size, THREE.LinearSRGBColorSpace),
    aoMap: dataTexture(ao, size, THREE.LinearSRGBColorSpace),
  };
}

function sampleHeight(kind, u, v) {
  if (kind === 'grass') return fbm(u * 18, v * 18, 5) * 0.7 + fbm(u * 54, v * 54, 3) * 0.3;
  if (kind === 'rock') return fbm(u * 12, v * 9, 6);
  if (kind === 'sand') return fbm(u * 22, v * 8, 4) * 0.65 + Math.abs(Math.sin(u * 40)) * 0.12;
  if (kind === 'dirt') return fbm(u * 14, v * 14, 5);
  if (kind === 'concrete') return fbm(u * 8, v * 8, 3) * 0.4 + ((Math.floor(u * 8) + Math.floor(v * 8)) % 2) * 0.08;
  if (kind === 'brick') return ((Math.floor(v * 12) % 2) * 0.08) + fbm(u * 20, v * 10, 3) * 0.25;
  if (kind === 'wood') return Math.abs(Math.sin(v * 28 + fbm(u * 6, v * 6, 2))) * 0.5 + fbm(u * 40, v * 4, 3) * 0.3;
  if (kind === 'metal') return fbm(u * 30, v * 6, 3) * 0.25;
  if (kind === 'fabric') return fbm(u * 40, v * 40, 4) * 0.45;
  if (kind === 'skin') return fbm(u * 10, v * 10, 3) * 0.2;
  if (kind === 'asphalt') return fbm(u * 16, v * 16, 4) * 0.5;
  return fbm(u * 12, v * 12, 4);
}

function dataTexture(data, size, colorSpace) {
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  texture.anisotropy = 4;
  return texture;
}

function lerpByte(a, b, t) {
  return Math.round(a + (b - a) * t);
}

const PALETTES = {
  grass: { dark: [62, 92, 42], light: [118, 148, 68], roughness: 0.92, roughnessVar: 0.08, normalScale: 4.2 },
  dirt: { dark: [78, 58, 36], light: [128, 102, 62], roughness: 0.94, roughnessVar: 0.06, normalScale: 3.4 },
  rock: { dark: [72, 70, 66], light: [150, 146, 136], roughness: 0.86, roughnessVar: 0.12, normalScale: 6.5 },
  sand: { dark: [156, 128, 82], light: [214, 190, 132], roughness: 0.9, roughnessVar: 0.05, normalScale: 2.4 },
  concrete: { dark: [110, 110, 104], light: [168, 166, 158], roughness: 0.88, roughnessVar: 0.06, normalScale: 2.2 },
  brick: { dark: [98, 58, 42], light: [168, 108, 82], roughness: 0.9, roughnessVar: 0.08, normalScale: 3.8 },
  wood: { dark: [62, 42, 28], light: [140, 102, 62], roughness: 0.82, roughnessVar: 0.1, normalScale: 2.8 },
  metal: { dark: [48, 54, 58], light: [120, 130, 136], roughness: 0.38, roughnessVar: 0.18, normalScale: 1.6 },
  fabric: { dark: [36, 58, 50], light: [72, 102, 88], roughness: 0.78, roughnessVar: 0.08, normalScale: 2.1 },
  skin: { dark: [168, 118, 88], light: [214, 170, 132], roughness: 0.62, roughnessVar: 0.08, normalScale: 1.2 },
  asphalt: { dark: [38, 40, 42], light: [72, 74, 76], roughness: 0.9, roughnessVar: 0.06, normalScale: 2.0 },
};

export const SURFACE_KINDS = Object.keys(PALETTES);
