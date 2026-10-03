import * as THREE from 'three';
import { ARENA } from '../config/settings.js';
import { Random } from '../utils/rng.js';
import { CircleBlocker } from '../physics/Collider.js';
import { getMaterial } from './materials.js';
import { FOREST_PATCHES, MOUNTAIN_RANGES, POI_DEFINITIONS, ROAD_NETWORK } from './MapData.js';

/**
 * Seeded, instanced island foliage and stone. Trees cluster into authored
 * forest biomes, rocks favour the ridge systems and low grass fills open ground;
 * towns, road corridors, beaches and riverbanks stay navigable.
 */
export class Nature {
  constructor({ world, terrain, quality }) {
    this.world = world;
    this.terrain = terrain;
    this.quality = quality;
    this.random = new Random(`${world.seed}:island-nature`);
    this.group = new THREE.Group();
    this.group.name = 'nature';
    this.cylinders = [];
    this.counts = { trees: 0, rocks: 0, grass: 0 };
  }

  build() {
    this._scatterTrees(this.quality.trees);
    this._scatterRocks(this.quality.rocks);
    if (this.quality.grassTufts > 0) this._scatterGrass(this.quality.grassTufts);
    if ((this.quality.bushes ?? 0) > 0) this._scatterBushes(this.quality.bushes);
    return this;
  }

  /** Deterministic rejection sampler shared by the three biome-scatter passes. */
  _pickPositions(count, {
    biome = 'forest',
    spacing = 5,
    maxSlope = ARENA.maxSlope,
    poiClearance = 20,
    roadClearance = 10,
    coastMargin = 14,
  } = {}) {
    const positions = [];
    const occupied = new Set();
    const cellSize = Math.max(2, spacing);
    const attempts = count * 34;

    for (let i = 0; i < attempts && positions.length < count; i += 1) {
      const point = this._randomBiomePoint(biome);
      if (!point) continue;
      const { x, z } = point;
      if (!this.terrain.isLandAt(x, z, coastMargin)) continue;
      if (this.terrain.coastDistanceAt(x, z) < coastMargin) continue;
      if (this.terrain.riverDistanceAt(x, z) < 16) continue;
      if (this.terrain.slopeAt(x, z) > maxSlope) continue;
      if (this._nearPOI(x, z, poiClearance)) continue;
      if (this._nearRoad(x, z, roadClearance)) continue;

      const cx = Math.floor(x / cellSize);
      const cz = Math.floor(z / cellSize);
      let blocked = false;
      for (let dx = -1; dx <= 1 && !blocked; dx += 1) {
        for (let dz = -1; dz <= 1 && !blocked; dz += 1) {
          if (occupied.has(`${cx + dx},${cz + dz}`)) blocked = true;
        }
      }
      if (blocked) continue;

      occupied.add(`${cx},${cz}`);
      positions.push({ x, z, y: this.terrain.heightAt(x, z) });
    }
    return positions;
  }

  _randomBiomePoint(biome) {
    if (biome === 'forest') {
      const patch = this.random.pick(FOREST_PATCHES);
      const angle = this.random.range(0, Math.PI * 2);
      const radius = Math.sqrt(this.random.next()) * patch.radius;
      return {
        x: patch.center[0] + Math.cos(angle) * radius,
        z: patch.center[1] + Math.sin(angle) * radius,
      };
    }

    if (biome === 'rock') {
      const range = this.random.pick(MOUNTAIN_RANGES);
      const angle = this.random.range(0, Math.PI * 2);
      const radius = Math.sqrt(this.random.next()) * range.radius * 1.38;
      return {
        x: range.center[0] + Math.cos(angle) * radius,
        z: range.center[1] + Math.sin(angle) * radius,
      };
    }

    // Grass tufts are weighted towards the open agricultural valley and clearings.
    const farm = POI_DEFINITIONS.find((poi) => poi.theme === 'farm');
    const center = this.random.chance(0.72) ? farm.center : this.random.pick(FOREST_PATCHES).center;
    const angle = this.random.range(0, Math.PI * 2);
    const radius = this.random.range(150, 520);
    return { x: center[0] + Math.cos(angle) * radius, z: center[1] + Math.sin(angle) * radius };
  }

  _nearPOI(x, z, clearance) {
    for (const poi of POI_DEFINITIONS) {
      const dx = x - poi.center[0];
      const dz = z - poi.center[1];
      const radius = poi.radius + clearance;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  _nearRoad(x, z, clearance) {
    const limit = clearance * clearance;
    for (const road of ROAD_NETWORK) {
      for (let i = 0; i < road.points.length - 1; i += 1) {
        const a = road.points[i];
        const b = road.points[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const lengthSq = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
        const ox = x - (a[0] + dx * t);
        const oz = z - (a[1] + dz * t);
        if (ox * ox + oz * oz < limit) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- trees --

  _scatterTrees(count) {
    if (count <= 0) return;
    const spots = this._pickPositions(count, {
      biome: 'forest', spacing: 9.2, maxSlope: 0.48, poiClearance: 22, roadClearance: 18,
    });
    if (spots.length === 0) return;

    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.32, 4.6, 8);
    trunkGeometry.translate(0, 2.3, 0);
    const lowerGeometry = new THREE.SphereGeometry(2.05, 8, 6);
    lowerGeometry.translate(0, 4.8, 0);
    const upperGeometry = new THREE.SphereGeometry(1.45, 8, 6);
    upperGeometry.translate(0, 6.5, 0);

    const trunks = new THREE.InstancedMesh(trunkGeometry, getMaterial('bark'), spots.length);
    const lower = new THREE.InstancedMesh(lowerGeometry, getMaterial('leaves'), spots.length);
    const upper = new THREE.InstancedMesh(upperGeometry, getMaterial('leavesDark'), spots.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const scale = this.random.range(0.78, 1.36);
      dummy.position.set(spot.x, spot.y - 0.1, spot.z);
      dummy.rotation.set(0, this.random.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale * this.random.range(0.9, 1.2), scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      lower.setMatrixAt(i, dummy.matrix);
      upper.setMatrixAt(i, dummy.matrix);

      const tint = this.random.range(0.78, 1.12);
      color.setRGB(tint, tint * this.random.range(0.93, 1.07), tint * this.random.range(0.82, 1.08));
      lower.setColorAt(i, color);
      upper.setColorAt(i, color.multiplyScalar(this.random.range(0.82, 0.94)));

      this.cylinders.push(new CircleBlocker({
        x: spot.x, z: spot.z, y: spot.y - 0.2,
        radius: 0.48 * scale,
        height: 4.4 * scale,
        name: 'tree',
      }));
    }

    for (const mesh of [trunks, lower, upper]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = this.quality.treeShadows !== false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.counts.trees = spots.length;
  }

  _scatterBushes(count) {
    const spots = this._pickPositions(count, {
      biome: 'forest', spacing: 6, maxSlope: 0.5, poiClearance: 18, roadClearance: 12, coastMargin: 18,
    });
    if (spots.length === 0) return;
    const geometry = new THREE.SphereGeometry(0.85, 7, 5);
    geometry.translate(0, 0.55, 0);
    const mesh = new THREE.InstancedMesh(geometry, getMaterial('leavesDark'), spots.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const scale = this.random.range(0.7, 1.4);
      dummy.position.set(spot.x, spot.y, spot.z);
      dummy.rotation.set(0, this.random.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale * 1.2, scale * 0.7, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setRGB(this.random.range(0.7, 1), this.random.range(0.85, 1.1), this.random.range(0.6, 0.9));
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.counts.bushes = spots.length;
  }

  // ---------------------------------------------------------------- rocks --

  _scatterRocks(count) {
    if (count <= 0) return;
    const spots = this._pickPositions(count, {
      biome: 'rock', spacing: 7, maxSlope: 0.78, poiClearance: 26, roadClearance: 12,
    });
    if (spots.length === 0) return;

    const geometry = new THREE.IcosahedronGeometry(1, this.quality.pbrMaps ? 1 : 0);
    const mesh = new THREE.InstancedMesh(geometry, getMaterial('rock'), spots.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const size = this.random.range(0.75, 2.8);
      const wide = this.random.range(1.05, 1.75);
      const height = size * this.random.range(1.1, 1.85);
      dummy.position.set(spot.x, spot.y + height * 0.34, spot.z);
      dummy.rotation.set(this.random.range(-0.3, 0.3), this.random.range(0, Math.PI * 2), this.random.range(-0.3, 0.3));
      dummy.scale.set(size * wide, height * 0.75, size * wide);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const shade = this.random.range(0.8, 1.18);
      color.setRGB(shade, shade * this.random.range(0.94, 1.05), shade * this.random.range(0.9, 1.1));
      mesh.setColorAt(i, color);

      if (height > 1.1) {
        this.cylinders.push(new CircleBlocker({
          x: spot.x, z: spot.z, y: spot.y,
          radius: size * wide * 0.78,
          height,
          name: 'rock',
        }));
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.counts.rocks = spots.length;
  }

  // ---------------------------------------------------------------- grass --

  _scatterGrass(count) {
    const geometry = new THREE.BufferGeometry();
    const w = 0.44;
    const h = 0.48;
    const vertices = new Float32Array([
      -w, 0, 0, w, 0, 0, w, h, 0,
      -w, 0, 0, w, h, 0, -w, h, 0,
      0, 0, -w, 0, 0, w, 0, h, w,
      0, 0, -w, 0, h, w, 0, h, -w,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const spots = this._pickPositions(count, {
      biome: 'field', spacing: 2.1, maxSlope: 0.52, poiClearance: 22, roadClearance: 9,
    });
    if (spots.length === 0) return;

    const mesh = new THREE.InstancedMesh(geometry, getMaterial('grass'), spots.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const scale = this.random.range(0.7, 1.45);
      dummy.position.set(spot.x, spot.y + 0.025, spot.z);
      dummy.rotation.set(0, this.random.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale * this.random.range(0.85, 1.35), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const tint = this.random.range(0.83, 1.15);
      color.setRGB(tint, tint * this.random.range(0.95, 1.08), tint * this.random.range(0.78, 0.95));
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.counts.grass = spots.length;
  }

  dispose() {
    this.group.traverse((child) => child.geometry?.dispose?.());
    this.group.clear();
    this.cylinders.length = 0;
  }
}
