import * as THREE from 'three';
import { getMaterial } from './materials.js';

/**
 * A small arrival plaza at Central City, not a training arena or map boundary.
 * The only runtime player placement still happens here once at match entry;
 * the eight points are clear candidates for that single local spawn.
 */
export class Arena {
  constructor({ world, terrain, quality }) {
    this.world = world;
    this.terrain = terrain;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'arrival-plaza';
    this.boxes = [];
    this.cylinders = [];
    this.spawnPoints = [];
  }

  build() {
    this._buildPlaza();
    this._buildSpawnPoints();
    return this;
  }

  _buildPlaza() {
    const groundY = this.terrain.heightAt(0, 0);
    const paving = new THREE.Mesh(
      new THREE.CircleGeometry(11.5, 48),
      getMaterial('arrivalStone'),
    );
    paving.rotation.x = -Math.PI / 2;
    paving.position.y = groundY + 0.035;
    paving.receiveShadow = true;
    paving.name = 'central-arrival-plaza';
    this.group.add(paving);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(10.9, 11.3, 64),
      getMaterial('padMarking'),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = groundY + 0.055;
    ring.name = 'plaza-inlay';
    this.group.add(ring);
  }

  _buildSpawnPoints() {
    const radius = 6.2;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      this.spawnPoints.push(
        new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
      );
    }
  }

  dispose() {
    this.group.traverse((child) => child.geometry?.dispose?.());
    this.group.clear();
    this.boxes.length = 0;
    this.cylinders.length = 0;
  }
}
