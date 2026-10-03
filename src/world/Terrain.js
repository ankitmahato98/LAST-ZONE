import * as THREE from 'three';
import { TERRAIN } from '../config/settings.js';
import { ValueNoise2D } from '../utils/noise.js';
import { hashSeed } from '../utils/rng.js';
import { clamp, smoothstep } from '../utils/math.js';
import { FOREST_PATCHES, MOUNTAIN_RANGES, POI_DEFINITIONS, RIVER_PATH } from './MapData.js';

/**
 * Deterministic analytic heightfield for the LAST ZONE island.
 *
 * The land is a roughly 4 km, softly squared island with an irregular beach
 * line, a downhill river, hand-authored highland masses and a distinct graded
 * building terrace at each POI. The exact same function feeds the visible mesh,
 * movement, spawn validation, camera probes and hitscan collision.
 */
export class Terrain {
  constructor({ world, quality, config = TERRAIN }) {
    this.world = world;
    this.quality = quality;
    this.config = config;
    this.seed = world.seed;
    this.noise = new ValueNoise2D(hashSeed(world.seed));
    this.detailNoise = new ValueNoise2D(hashSeed(`${world.seed}:detail`));
    this.coastNoise = new ValueNoise2D(hashSeed(`${world.seed}:coast`));

    this.size = world.size;
    this.half = world.size / 2;
    this.mesh = null;
    this.waterMesh = null;
    this._riverScratch = { distance: Infinity, progress: 0, surface: 0 };
    this._riverSegments = buildRiverSegments();
    this._riverLength = this._riverSegments.at(-1)?.endDistance ?? 1;
    this._riverSurfaceProfile = this._buildRiverSurfaceProfile();
    this.poiTerrain = POI_DEFINITIONS.map((poi) => ({
      poi,
      x: poi.center[0],
      z: poi.center[1],
      centerHeight: this._baseLandHeight(poi.center[0], poi.center[1]),
    }));
  }

  // ------------------------------------------------------- height sampling --

  heightAt(x, z) {
    const cfg = this.config;
    const distance = Math.hypot(x, z);
    const coastDistance = this.coastlineRadiusAt(Math.atan2(z, x)) - distance;

    if (coastDistance < 0) {
      const oceanBlend = smoothstep(-cfg.oceanShelfWidth, 0, coastDistance);
      return cfg.seaLevel - cfg.oceanDepth
        + (cfg.beachElevation - (cfg.seaLevel - cfg.oceanDepth)) * oceanBlend;
    }

    let height = this._baseLandHeight(x, z);
    const river = this._sampleRiver(x, z);

    // A broad lowered corridor reads as a genuine river valley. The channel
    // itself is carved after POI grading so a town terrace cannot fill it in.
    const valley = 1 - smoothstep(cfg.riverValleyStart, cfg.riverValleyWidth, river.distance);
    if (valley > 0) {
      const valleyFloor = river.surface + cfg.riverValleyFloor;
      height += (Math.min(height, valleyFloor) - height) * valley;
    }

    // Wide, individually graded plateaus make each settlement buildable while
    // preserving the high and low terrain around it.
    for (const { poi, x: px, z: pz, centerHeight } of this.poiTerrain) {
      const d = Math.hypot(x - px, z - pz);
      if (d >= poi.flattenRadius + cfg.poiBlendWidth) continue;
      const flat = 1 - smoothstep(poi.flattenRadius, poi.flattenRadius + cfg.poiBlendWidth, d);
      height += (centerHeight - height) * flat;
    }

    const bank = 1 - smoothstep(cfg.riverHalfWidth, cfg.riverBankWidth, river.distance);
    let minimumLandHeight = 3;
    if (bank > 0) {
      const riverBed = river.surface - cfg.riverDepth;
      height += (Math.min(height, riverBed) - height) * bank;
      // Keep the mouth cut below its low downstream water surface rather than
      // clamping it back above the water line.
      if (riverBed < minimumLandHeight) minimumLandHeight = riverBed;
    }
    height = Math.max(minimumLandHeight, height);

    // A narrow raised-sand transition meets the shallow seabed continuously.
    const shore = 1 - smoothstep(0, cfg.beachWidth, coastDistance);
    height += (cfg.beachElevation - height) * shore;
    return height;
  }

  _baseLandHeight(x, z) {
    const cfg = this.config;
    const broad = this.noise.fbm(x * cfg.broadScale, z * cfg.broadScale, { octaves: 5 });
    const hills = this.noise.fbm(x * cfg.hillScale, z * cfg.hillScale, { octaves: 4 });
    const detail = this.detailNoise.fbm(x * cfg.detailScale, z * cfg.detailScale, { octaves: 3 });
    let height = 30 + broad * cfg.broadAmplitude + hills * cfg.hillAmplitude + detail * cfg.detailAmplitude;

    for (const range of MOUNTAIN_RANGES) {
      const dx = x - range.center[0];
      const dz = z - range.center[1];
      const distanceSq = dx * dx + dz * dz;
      const radiusSq = range.radius * range.radius;
      height += range.height * Math.exp(-distanceSq / (radiusSq * 0.42));
    }

    // A few broad, low saddles make the island read as ridges and valleys,
    // rather than a collection of isolated cone-shaped hills.
    height -= 24 * Math.exp(-(((x - 180) ** 2) / 450000 + ((z - 460) ** 2) / 350000));
    height -= 20 * Math.exp(-(((x + 680) ** 2) / 500000 + ((z + 610) ** 2) / 330000));

    return Math.max(3, height);
  }

  _buildRiverSurfaceProfile() {
    const levels = [];
    let travelled = 0;
    let previous = Infinity;
    for (let i = 0; i < RIVER_PATH.length; i += 1) {
      const [x, z] = RIVER_PATH[i];
      if (i > 0) travelled += this._riverSegments[i - 1]?.length ?? 0;
      const progress = travelled / this._riverLength;
      const designed = 76 + (this.config.seaLevel + 1.3 - 76) * progress;
      const terrainCap = this._baseLandHeight(x, z) - 1.5;
      let level = Math.min(designed, terrainCap);
      if (i > 0) {
        const segmentLength = this._riverSegments[i - 1]?.length ?? 0;
        level = Math.min(level, previous - Math.max(0.12, segmentLength * 0.00035));
      }
      if (i === RIVER_PATH.length - 1) level = Math.min(level, this.config.seaLevel + 1.3);
      levels.push(level);
      previous = level;
    }
    return levels;
  }

  /**
   * Radius of the coastline in the requested direction. A superellipse keeps
   * the map broad and readable while the seeded angular noise breaks up the
   * shoreline into bays, points and coves.
   */
  coastlineRadiusAt(angle) {
    const cfg = this.config;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const power = cfg.coastPower;
    const norm = (Math.abs(cos) ** power + Math.abs(sin) ** power) ** (1 / power);
    const base = cfg.coastRadius / Math.max(norm, 1e-5);
    const irregular = this.coastNoise.noise(cos * 2.1 + 7.4, sin * 2.1 - 3.2) * cfg.coastVariation
      + Math.sin(angle * 3 + 0.7) * cfg.coastVariation * 0.2
      + Math.sin(angle * 7 - 1.1) * cfg.coastVariation * 0.11;
    return clamp(base + irregular, cfg.coastRadius * 0.91, this.half - 42);
  }

  _sampleRiver(x, z) {
    let bestDistanceSq = Infinity;
    let bestProgress = 0;
    let bestSurface = this.config.seaLevel + 1.3;
    for (const segment of this._riverSegments) {
      const dx = segment.bx - segment.ax;
      const dz = segment.bz - segment.az;
      const t = clamp(((x - segment.ax) * dx + (z - segment.az) * dz) / segment.lengthSq, 0, 1);
      const px = segment.ax + dx * t;
      const pz = segment.az + dz * t;
      const ox = x - px;
      const oz = z - pz;
      const distanceSq = ox * ox + oz * oz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestProgress = (segment.startDistance + segment.length * t) / this._riverLength;
        const start = this._riverSurfaceProfile[segment.index] ?? this.config.seaLevel + 1.3;
        const end = this._riverSurfaceProfile[segment.index + 1] ?? start;
        bestSurface = start + (end - start) * t;
      }
    }

    const out = this._riverScratch;
    out.distance = Math.sqrt(bestDistanceSq);
    out.progress = clamp(bestProgress, 0, 1);
    out.surface = bestSurface;
    return out;
  }

  /** Public helpers used by scenery, bridge placement and biome validation. */
  riverDistanceAt(x, z) {
    return this._sampleRiver(x, z).distance;
  }

  riverSurfaceAt(x, z) {
    return this._sampleRiver(x, z).surface;
  }

  /** Public helper used by boundaries, beaches and spawn validation. */
  coastDistanceAt(x, z) {
    return this.coastlineRadiusAt(Math.atan2(z, x)) - Math.hypot(x, z);
  }

  /** The island includes beaches; an optional margin keeps actors off cliffs. */
  isLandAt(x, z, margin = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (Math.abs(x) > this.half - margin || Math.abs(z) > this.half - margin) return false;
    return this.coastDistanceAt(x, z) >= margin;
  }

  /** Compatibility name used by world and spawn validation. */
  isInside(x, z, margin = 0) {
    return this.isLandAt(x, z, margin);
  }

  /** |gradient| of the height field: 0 = flat, 1 = 45 degrees. */
  slopeAt(x, z, epsilon = 0.6) {
    const hx = this.heightAt(x + epsilon, z) - this.heightAt(x - epsilon, z);
    const hz = this.heightAt(x, z + epsilon) - this.heightAt(x, z - epsilon);
    return Math.hypot(hx, hz) / (2 * epsilon);
  }

  /** Height of the ground at a position-like object. */
  heightAtPosition(position) {
    return this.heightAt(position.x, position.z);
  }

  // ------------------------------------------------------------- geometry --

  build(material = null) {
    const segments = this.quality.terrainSegments;
    const geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = this.heightAt(x, z);
      position.setY(i, y);

      this._shadeVertex(color, x, y, z);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(
      geometry,
      material ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
    );
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }

  _shadeVertex(color, x, y, z) {
    const slope = this.slopeAt(x, z, 1.6);
    const coast = this.coastDistanceAt(x, z);
    const grain = this.detailNoise.noise(x * 0.07, z * 0.07) * 0.5 + 0.5;
    const grass = mixColor(GRASS_LOW, GRASS_HIGH, grain);
    const field = mixColor(FIELD_LOW, FIELD_HIGH, grain);
    const rock = mixColor(ROCK, ROCK_LIGHT, grain);
    const sand = mixColor(SAND, SAND_LIGHT, grain * 0.55);

    color.copy(grass);
    for (const patch of FOREST_PATCHES) {
      const distance = Math.hypot(x - patch.center[0], z - patch.center[1]);
      const forest = 1 - smoothstep(patch.radius * 0.48, patch.radius, distance);
      if (forest > 0) color.lerp(FOREST_GREEN, forest * 0.38);
    }
    for (const poi of POI_DEFINITIONS) {
      if (poi.theme !== 'farm') continue;
      const distance = Math.hypot(x - poi.center[0], z - poi.center[1]);
      const fieldWeight = 1 - smoothstep(poi.radius * 0.42, poi.radius * 1.5, distance);
      if (fieldWeight > 0) color.lerp(field, fieldWeight * 0.58);
    }

    color.lerp(rock, smoothstep(0.36, 0.78, slope));
    color.lerp(rock, smoothstep(105, 205, y) * 0.55);
    color.lerp(sand, 1 - smoothstep(24, 88, coast));

    const river = this._sampleRiver(x, z);
    color.lerp(WET_GRASS, (1 - smoothstep(13, 38, river.distance)) * 0.82);

    const sunlitAltitude = 1 - smoothstep(12, 250, y) * 0.12;
    color.multiplyScalar(sunlitAltitude);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material?.dispose?.();
    this.waterMesh?.geometry.dispose();
    this.waterMesh?.material?.dispose?.();
    this.mesh = null;
    this.waterMesh = null;
  }
}

const GRASS_LOW = new THREE.Color('#4c673b');
const GRASS_HIGH = new THREE.Color('#789052');
const FOREST_GREEN = new THREE.Color('#345739');
const FIELD_LOW = new THREE.Color('#7e7842');
const FIELD_HIGH = new THREE.Color('#a28b4d');
const ROCK = new THREE.Color('#66665f');
const ROCK_LIGHT = new THREE.Color('#96958b');
const SAND = new THREE.Color('#a58d62');
const SAND_LIGHT = new THREE.Color('#d2bb85');
const WET_GRASS = new THREE.Color('#47664d');

function mixColor(a, b, t) {
  return a.clone().lerp(b, t);
}

function buildRiverSegments() {
  const segments = [];
  let travelled = 0;
  for (let i = 0; i < RIVER_PATH.length - 1; i += 1) {
    const [ax, az] = RIVER_PATH[i];
    const [bx, bz] = RIVER_PATH[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) continue;
    segments.push({
      index: i,
      ax, az, bx, bz,
      length,
      lengthSq: length * length,
      startDistance: travelled,
    });
    travelled += length;
    segments[segments.length - 1].endDistance = travelled;
  }
  return segments;
}
