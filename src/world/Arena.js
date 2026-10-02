import * as THREE from 'three';
import { BoxBlocker, CircleBlocker } from '../physics/Collider.js';
import { getMaterial } from './materials.js';

/**
 * The test arena at the centre of the map: a flat training ground with a broken
 * perimeter wall, climbable crates, a step-up platform and a couple of towers.
 *
 * It exists to prove out the systems the rest of the game depends on - it gives
 * the player somewhere to run, jump, step up onto and collide with from the
 * first second. It is deliberately data driven: `_buildStructures()` returns a
 * list describing placements, so turning this into a real map is a data change,
 * not a code change.
 */
export class Arena {
  constructor({ world, terrain, quality }) {
    this.world = world;
    this.terrain = terrain;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'arena';

    /** @type {BoxBlocker[]} */
    this.boxes = [];
    /** @type {CircleBlocker[]} */
    this.cylinders = [];
    /** @type {THREE.Vector3[]} */
    this.spawnPoints = [];
  }

  build() {
    this._buildPad();
    this._buildStructures();
    this._buildSpawnPoints();
    return this;
  }

  // --------------------------------------------------------------- pieces --

  _buildPad() {
    const padRadius = 7;

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(padRadius, 56),
      getMaterial('pad'),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    disc.receiveShadow = true;
    this.group.add(disc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(padRadius - 0.2, padRadius, 64),
      getMaterial('padMarking'),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.group.add(ring);

    // Cardinal ticks so the player can read their orientation.
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      const tick = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, padRadius - 1),
        getMaterial('padMarking'),
      );
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = -angle;
      tick.position.set(Math.sin(angle) * (padRadius / 2), 0.025, Math.cos(angle) * (padRadius / 2));
      this.group.add(tick);
    }
  }

  /**
   * Every structure is placed relative to the arena centre on purpose: the pad
   * sits on perfectly flat terrain (see TERRAIN.flatRadius), so nothing needs
   * to be snapped to the heightfield except the perimeter.
   */
  _buildStructures() {
    const wallRadius = 21;
    const wallSegments = 8;
    const wallGaps = new Set([2, 6]); // leave two openings

    for (let i = 0; i < wallSegments; i += 1) {
      if (wallGaps.has(i)) continue;
      const angle = (i / wallSegments) * Math.PI * 2;
      const x = Math.sin(angle) * wallRadius;
      const z = Math.cos(angle) * wallRadius;
      this._addBox({
        position: [x, 1.5, z],
        size: [13, 3, 0.8],
        yaw: angle,
        material: i % 2 === 0 ? 'concrete' : 'concreteDark',
        name: `wall-${i}`,
      });
    }

    // --- Crate stack: a 1.0m step and a 2.0m box to jump onto ---------------
    this._addBox({ position: [9, 0.5, -7], size: [2, 1, 2], material: 'crateWood', walkable: true, name: 'crate-step' });
    this._addBox({ position: [11.6, 1, -7], size: [2, 2, 2], material: 'crateWood', walkable: true, name: 'crate-big' });
    this._addBox({ position: [9, 2, -7], size: [1.6, 2, 1.6], material: 'crateMetal', yaw: 0.35, walkable: true, name: 'crate-top' });

    // --- Low platform: exercises the step-up path --------------------------
    this._addBox({ position: [-10, 0.2, 9], size: [7, 0.4, 7], material: 'concrete', walkable: true, name: 'step-platform' });
    this._addBox({ position: [-10, 0.7, 9], size: [3.5, 0.6, 3.5], material: 'concreteDark', walkable: true, name: 'step-platform-2' });

    // --- Towers: pure wall collision --------------------------------------
    this._addBox({ position: [0, 3, -15], size: [3.2, 6, 3.2], material: 'concrete', name: 'tower-n' });
    this._addBox({ position: [-15, 2.6, -6], size: [2.4, 5.2, 2.4], material: 'metalPainted', name: 'tower-w' });

    // --- Barrels: cylinder collisions --------------------------------------
    const barrelSpots = [
      [6, 12],
      [7.4, 12.6],
      [-4, -12],
      [16, 3],
      [-16.5, 4],
    ];
    for (let i = 0; i < barrelSpots.length; i += 1) {
      const [x, z] = barrelSpots[i];
      this._addBarrel(x, z, 0.55, 1.3, `barrel-${i}`);
    }

    // --- Cover blocks on the outside of the ring ---------------------------
    const coverSpots = [
      [24, -14, 4, 1.6, 0.4],
      [-24, -16, 5, 1.4, -0.3],
      [-27, 8, 3.5, 1.8, 0.9],
      [22, 20, 4.5, 1.2, -0.7],
    ];
    for (let i = 0; i < coverSpots.length; i += 1) {
      const [x, z, width, height, yaw] = coverSpots[i];
      this._addBox({
        position: [x, height / 2, z],
        size: [width, height, 1],
        yaw,
        material: 'concreteDark',
        walkable: height <= 1.2,
        name: `cover-${i}`,
      });
    }
  }

  _addBox({ position, size, yaw = 0, material, walkable = false, name }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      getMaterial(material),
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    this.group.add(mesh);

    this.boxes.push(
      new BoxBlocker({
        center: { x: position[0], y: position[1], z: position[2] },
        size: { x: size[0], y: size[1], z: size[2] },
        yaw,
        walkable,
        name,
      }),
    );
    return mesh;
  }

  _addBarrel(x, z, radius, height, name) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 16),
      getMaterial('metal'),
    );
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    this.group.add(mesh);
    this.cylinders.push(new CircleBlocker({ x, z, radius, height, name }));
    return mesh;
  }

  /** Candidate drop points for a future lobby / match start. */
  _buildSpawnPoints() {
    const radius = 5.6;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      this.spawnPoints.push(
        new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius),
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
