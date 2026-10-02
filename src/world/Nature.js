import * as THREE from 'three';
import { ARENA } from '../config/settings.js';
import { Random } from '../utils/rng.js';
import { CircleBlocker } from '../physics/Collider.js';
import { getMaterial } from './materials.js';

/**
 * Procedural scenery: trees, boulders and grass, scattered with a seeded RNG.
 *
 * Everything is an `InstancedMesh` (one draw call per type, shadows included),
 * and every instance is placed with the same rules - inside the scatter ring,
 * on ground that is not too steep, and never on top of another instance. The
 * colliders it returns use the exact same transforms, so what you see is what
 * you bump into.
 */
export class Nature {
  constructor({ world, terrain, quality }) {
    this.world = world;
    this.terrain = terrain;
    this.quality = quality;
    this.random = new Random(`${world.seed}:nature`);

    this.group = new THREE.Group();
    this.group.name = 'nature';
    /** @type {CircleBlocker[]} */
    this.cylinders = [];
    this.counts = { trees: 0, rocks: 0, grass: 0 };
  }

  build() {
    this._scatterTrees(this.quality.trees);
    this._scatterRocks(this.quality.rocks);
    if (this.quality.grassTufts > 0) this._scatterGrass(this.quality.grassTufts);
    return this;
  }

  // ------------------------------------------------------------- placement --

  /** Rejection sampling with a coarse grid so props never overlap. */
  _pickPositions(count, { minRadius, maxRadius, spacing = 4, maxSlope = ARENA.maxSlope }) {
    const positions = [];
    const cellSize = spacing;
    const occupied = new Set();
    const attempts = count * 14;

    for (let i = 0; i < attempts && positions.length < count; i += 1) {
      const angle = this.random.range(0, Math.PI * 2);
      const radius = Math.sqrt(this.random.range(
        (minRadius / maxRadius) ** 2,
        1,
      )) * maxRadius;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!this.terrain.isInside(x, z, 12)) continue;
      if (this.terrain.slopeAt(x, z) > maxSlope) continue;

      const cx = Math.round(x / cellSize);
      const cz = Math.round(z / cellSize);
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

  // ---------------------------------------------------------------- trees --

  _scatterTrees(count) {
    if (count <= 0) return;
    const [minRadius, maxRadius] = ARENA.scatterRadius;
    const spots = this._pickPositions(count, { minRadius, maxRadius, spacing: 6, maxSlope: 0.34 });
    if (spots.length === 0) return;

    const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 4.4, 7);
    trunkGeometry.translate(0, 2.2, 0);
    const lowerGeometry = new THREE.ConeGeometry(2.3, 4.2, 8);
    lowerGeometry.translate(0, 4.6, 0);
    const upperGeometry = new THREE.ConeGeometry(1.55, 3.4, 8);
    upperGeometry.translate(0, 6.6, 0);

    const trunks = new THREE.InstancedMesh(trunkGeometry, getMaterial('bark'), spots.length);
    const lower = new THREE.InstancedMesh(lowerGeometry, getMaterial('leaves'), spots.length);
    const upper = new THREE.InstancedMesh(upperGeometry, getMaterial('leavesDark'), spots.length);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const scale = this.random.range(0.8, 1.35);
      dummy.position.set(spot.x, spot.y - 0.1, spot.z);
      dummy.rotation.set(0, this.random.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale * this.random.range(0.9, 1.2), scale);
      dummy.updateMatrix();

      trunks.setMatrixAt(i, dummy.matrix);
      lower.setMatrixAt(i, dummy.matrix);
      upper.setMatrixAt(i, dummy.matrix);

      // Trunk collider only - the canopy is above head height.
      this.cylinders.push(
        new CircleBlocker({
          x: spot.x,
          z: spot.z,
          y: spot.y - 0.2,
          radius: 0.5 * scale,
          height: 4.4 * scale,
          name: 'tree',
        }),
      );
    }

    for (const mesh of [trunks, lower, upper]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.counts.trees = spots.length;
  }

  // ---------------------------------------------------------------- rocks --

  _scatterRocks(count) {
    if (count <= 0) return;
    const [minRadius, maxRadius] = ARENA.scatterRadius;
    const spots = this._pickPositions(count, { minRadius, maxRadius, spacing: 5, maxSlope: 0.5 });
    if (spots.length === 0) return;

    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const mesh = new THREE.InstancedMesh(geometry, getMaterial('rock'), spots.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const size = this.random.range(0.7, 2.4);
      const wide = this.random.range(1.1, 1.7);
      const height = size * this.random.range(1.2, 1.8);

      dummy.position.set(spot.x, spot.y + height * 0.34, spot.z);
      dummy.rotation.set(this.random.range(-0.3, 0.3), this.random.range(0, Math.PI * 2), this.random.range(-0.3, 0.3));
      dummy.scale.set(size * wide, height * 0.75, size * wide);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Only boulders big enough to matter become obstacles.
      if (height > 1.1) {
        this.cylinders.push(
          new CircleBlocker({
            x: spot.x,
            z: spot.z,
            y: spot.y,
            radius: size * wide * 0.78,
            height,
            name: 'rock',
          }),
        );
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.counts.rocks = spots.length;
  }

  // ---------------------------------------------------------------- grass --

  /** Cheap stylised tufts (two crossed quads) around the playable centre. */
  _scatterGrass(count) {
    const geometry = new THREE.BufferGeometry();
    const w = 0.5;
    const h = 0.55;
    const vertices = new Float32Array([
      -w, 0, 0, w, 0, 0, w, h, 0,
      -w, 0, 0, w, h, 0, -w, h, 0,
      0, 0, -w, 0, 0, w, 0, h, w,
      0, 0, -w, 0, h, w, 0, h, -w,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const spots = this._pickPositions(count, {
      minRadius: 8,
      maxRadius: 78,
      spacing: 1.6,
      maxSlope: 0.45,
    });
    if (spots.length === 0) return;

    const mesh = new THREE.InstancedMesh(geometry, getMaterial('grass'), spots.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < spots.length; i += 1) {
      const spot = spots[i];
      const scale = this.random.range(0.7, 1.5);
      dummy.position.set(spot.x, spot.y, spot.z);
      dummy.rotation.set(0, this.random.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale * this.random.range(0.8, 1.4), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this.counts.grass = spots.length;
  }

  dispose() {
    this.group.traverse((child) => child.geometry?.dispose?.());
    this.group.clear();
    this.cylinders.length = 0;
  }
}
