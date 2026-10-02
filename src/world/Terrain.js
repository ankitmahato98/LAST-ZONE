import * as THREE from 'three';
import { TERRAIN } from '../config/settings.js';
import { ValueNoise2D } from '../utils/noise.js';
import { hashSeed } from '../utils/rng.js';
import { smoothstep } from '../utils/math.js';

/**
 * The ground.
 *
 * Height is a pure, deterministic function of (x, z):
 *
 *     h = fbm(x, z) * flatten(dist) + rim(dist)
 *
 * Two consequences that matter:
 *  - the mesh is just a sampling of that function, so the *simulation* never
 *    raycasts the terrain; `heightAt()` is exact and costs a few multiplications
 *  - the same seed always builds the same map, which keeps tests and (later)
 *    server/client agreement trivial
 *
 * The centre is kept perfectly flat so the arena is walkable from frame one; a
 * ring of mountains closes the world off visually and physically.
 */
export class Terrain {
  constructor({ world, quality, config = TERRAIN }) {
    this.world = world;
    this.quality = quality;
    this.config = config;
    this.noise = new ValueNoise2D(hashSeed(world.seed));
    this.detailNoise = new ValueNoise2D(hashSeed(`${world.seed}:detail`));

    this.size = world.size;
    this.half = world.size / 2;
    this.mesh = null;
  }

  // ------------------------------------------------------- height sampling --

  heightAt(x, z) {
    const cfg = this.config;
    const dist = Math.hypot(x, z);

    // Flat arena blending out into hills.
    const flatten = smoothstep(cfg.flatRadius, cfg.blendRadius, dist);

    if (flatten === 0) {
      // Inside the arena there is nothing but the boundary mountain check.
      return this._rimHeight(x, z);
    }

    const hills = this.noise.fbm(x * cfg.hillScale, z * cfg.hillScale, { octaves: 4 });
    const detail = this.detailNoise.noise(x * cfg.detailScale, z * cfg.detailScale);
    const rolling = hills * cfg.hillAmplitude + detail * cfg.detailAmplitude;

    return rolling * flatten + this._rimHeight(x, z);
  }

  _rimHeight(x, z) {
    const cfg = this.config;
    const rimDist = Math.max(Math.abs(x), Math.abs(z));
    if (rimDist <= cfg.rimStart) return 0;
    const t = smoothstep(cfg.rimStart, cfg.rimEnd, rimDist);
    return t * t * cfg.rimHeight;
  }

  /** |gradient| of the height field: 0 = flat, 1 = 45 degrees. */
  slopeAt(x, z, epsilon = 0.6) {
    const hx = this.heightAt(x + epsilon, z) - this.heightAt(x - epsilon, z);
    const hz = this.heightAt(x, z + epsilon) - this.heightAt(x, z - epsilon);
    return Math.hypot(hx, hz) / (2 * epsilon);
  }

  isInside(x, z, margin = 0) {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }

  /** Height of the ground at a position-like object. */
  heightAtPosition(position) {
    return this.heightAt(position.x, position.z);
  }

  // ------------------------------------------------------------- geometry --

  build(material) {
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
      material ??
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.95,
          metalness: 0,
        }),
    );
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }

  /**
   * Vertex colouring: grass on gentle slopes, rock where it gets steep, sand at
   * the arena and a darker tone in the mountain rim.
   */
  _shadeVertex(color, x, y, z) {
    const slope = this.slopeAt(x, z, 1.2);
    const dist = Math.hypot(x, z);
    const grain = this.detailNoise.noise(x * 0.09, z * 0.09) * 0.5 + 0.5;

    const grass = mixColor(GRASS_LOW, GRASS_HIGH, grain);
    const rock = mixColor(ROCK, ROCK_LIGHT, grain);
    const sand = mixColor(SAND, GRASS_LOW, grain * 0.35);

    color.copy(grass);
    color.lerp(rock, smoothstep(0.32, 0.72, slope));
    color.lerp(sand, 1 - smoothstep(ARENA_SAND_RADIUS - 6, ARENA_SAND_RADIUS + 4, dist));

    // Darken with altitude slightly - reads as atmospheric depth.
    const shading = 1 - smoothstep(6, 34, y) * 0.22;
    color.multiplyScalar(shading);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material?.dispose?.();
    this.mesh = null;
  }
}

const ARENA_SAND_RADIUS = 30;

const GRASS_LOW = new THREE.Color('#4e6b39');
const GRASS_HIGH = new THREE.Color('#6f8b4a');
const ROCK = new THREE.Color('#6d6a62');
const ROCK_LIGHT = new THREE.Color('#8e8a7e');
const SAND = new THREE.Color('#a08c62');

function mixColor(a, b, t) {
  return a.clone().lerp(b, t);
}
