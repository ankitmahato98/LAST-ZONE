import * as THREE from 'three';
import { LOOT, PLAYER, WORLD } from '../config/settings.js';
import { Random } from '../utils/rng.js';
import { rollLootTable, tableForAnchorKind } from './LootTables.js';
import { describeItem, lookupItem } from './items/ItemRegistry.js';
import { createLootVisuals, disposeLootVisuals, getLootVisual } from './LootVisuals.js';
import { ItemKind } from './items/ItemData.js';

/**
 * Physical world loot.
 *
 * Responsibilities:
 *   - turn validated world anchors into concrete pickups (rolled from the data
 *     loot tables, deterministically per anchor)
 *   - render every pickup with a handful of *instanced* meshes
 *   - answer "what is the nearest pickup to the player" cheaply (spatial hash)
 *   - spawn drops (a dropped weapon becomes a real, pickable entity)
 *
 * What it deliberately does NOT do: decide who can pick something up. That is
 * `InventorySystem`; this system only owns the world entities. Keeping the two
 * apart means a bot could later pick loot up with the same API the player uses.
 *
 * Performance notes (mobile is the target):
 *   - the whole map is a fixed number of `InstancedMesh` objects, one per visual
 *     part (single digits), never one mesh per pickup
 *   - instance slots are pooled; a drop reuses a free slot and can never grow
 *     the scene, so there is no allocation at runtime
 *   - nearest-pickup lookup walks a spatial hash (3x3 cells), allocates nothing
 *     and is called once per fixed step
 *   - the idle bob/rotation of nearby pickups is throttled and only touches
 *     pickups close enough to be seen
 */
export class LootSystem {
  constructor({ config = LOOT, seed = WORLD.seed } = {}) {
    this.name = 'loot';
    this.config = config;
    this.seed = seed;

    /** @type {Array<object>} world-space loot anchors */
    this.anchors = [];
    /** @type {Array<object>} live pickups (index === instance owner) */
    this.pickups = [];
    /** @type {Map<string, number[]>} spatial hash: cell key -> pickup indices */
    this.cells = new Map();
    /** @type {Map<string, object>} instance pools, one per visual id */
    this.pools = new Map();

    this.group = null;
    this.nearest = null;
    this._lastNearestId = null;
    this._animationTimer = 0;
    this._clock = 0;
    this._dropCounter = 0;
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpQuaternion = new THREE.Quaternion();
    this._tmpVector = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3(1, 1, 1);
  }

  // ------------------------------------------------------------------ setup --

  async init(game) {
    this.game = game;
    this.bus = game.bus;
    this.world = game.services.require('world');
    this.renderer = game.services.require('renderer');
    this.player = game.services.get('player');

    this.group = new THREE.Group();
    this.group.name = 'loot';
    this.renderer.worldGroup.add(this.group);

    this._buildAnchors();
    this._rollPickups();
    this._buildInstances();
    this._buildIndex();

    this.bus.emit('loot:ready', this.stats);
  }

  get stats() {
    const byKind = {};
    for (const pickup of this.pickups) {
      byKind[pickup.kind] = (byKind[pickup.kind] ?? 0) + 1;
    }
    return {
      anchors: this.anchors.length,
      pickups: this.pickups.length,
      dropped: this.pickups.filter((pickup) => pickup.dropped).length,
      byKind,
      instancePools: this.pools.size,
      instancedMeshes: [...this.pools.values()].reduce((sum, pool) => sum + pool.parts.length, 0),
    };
  }

  // -------------------------------------------------------------- anchors ----

  /**
   * Collect every loot anchor: POI interiors, outdoor cover crates, landmark
   * stashes and the guaranteed arrival-plaza kit. Anchors are validated against
   * the collider so no pickup can ever spawn inside a wall or off the island.
   */
  _buildAnchors() {
    const body = { radius: 0.38, height: PLAYER.height, stepHeight: PLAYER.stepHeight };
    const accepted = [];

    const consider = (anchor) => {
      if (!anchor?.position) return false;
      const { x, z } = anchor.position;
      const y = anchor.position.y ?? this.world.heightAt(x, z);
      if (!this.world.isWithinBounds(x, z, 1.2)) return false;
      if (this.world.slopeAt(x, z) > 0.55) return false;
      if (!this.world.collider.isClear(x, z, y, body)) return false;
      // Do not stack two pickups on top of each other.
      for (const other of accepted) {
        if (Math.hypot(other.position.x - x, other.position.z - z) < 1.6) return false;
      }
      accepted.push({
        id: anchor.id,
        kind: anchor.kind ?? 'crate',
        poiId: anchor.poiId ?? null,
        poiName: anchor.poiName ?? null,
        indoor: Boolean(anchor.indoor),
        position: { x, y, z },
        yaw: anchor.yaw ?? 0,
      });
      return true;
    };

    for (const anchor of this.world.lootAnchors ?? []) consider(anchor);
    for (const anchor of this._arrivalStashes()) consider(anchor);
    this.anchors = accepted;
  }

  /**
   * The arrival plaza always carries a small starting kit so a fresh run is
   * playable the moment the player deploys - a rifle, ammunition and one heal.
   * Locations are derived from the plaza spawn ring, which is already validated
   * ground.
   */
  _arrivalStashes() {
    const radius = this.config.stashRadius;
    const stashes = [];
    const layouts = [
      { angle: Math.PI * 0.25, kind: 'stash', id: 'plaza-stash-weapon-a' },
      { angle: Math.PI * 0.75, kind: 'stash', id: 'plaza-stash-weapon-b' },
      { angle: Math.PI * 1.25, kind: 'stash', kind2: 'crate', id: 'plaza-stash-supply' },
      { angle: Math.PI * 1.75, kind: 'crate', id: 'plaza-stash-medical' },
    ];
    for (const layout of layouts) {
      const x = Math.cos(layout.angle) * radius;
      const z = Math.sin(layout.angle) * radius;
      if (!this.world.isWithinBounds(x, z, 1.2)) continue;
      stashes.push({
        id: layout.id,
        kind: layout.kind2 ?? layout.kind,
        poiId: 'central-city',
        poiName: 'Central City',
        indoor: false,
        position: { x, y: this.world.groundHeightAt(x, z, this.world.heightAt(x, z) + 2, { radius: 0.4, height: 1.8, stepHeight: 0.6 }), z },
        yaw: layout.angle + Math.PI,
      });
    }
    return stashes;
  }

  // -------------------------------------------------------------- pickups ----

  /** Roll every anchor's table and turn the result into world pickups. */
  _rollPickups() {
    const drops = [];
    for (const anchor of this.anchors) {
      const tableId = anchor.kind === 'stash' ? 'spawn-stash' : tableForAnchorKind(anchor.kind);
      const random = new Random(`${this.seed}:loot:${anchor.id}`);
      const rolled = rollLootTable(tableId, random, (entry) => {
        const definition = lookupItem(entry.id);
        return Boolean(definition?.enabled);
      });
      for (const entry of rolled) {
        if (drops.length >= this.config.maxPickups) break;
        drops.push({ anchor, tableId, entry });
      }
    }

    for (let i = 0; i < drops.length; i += 1) {
      const { anchor, tableId, entry } = drops[i];
      const definition = lookupItem(entry.id);
      if (!definition) continue;
      const scatter = this._scatterOffset(anchor, i);
      const x = anchor.position.x + scatter.x;
      const z = anchor.position.z + scatter.z;
      const y = this.world.heightAt(x, z);
      this.pickups.push({
        id: `loot-${i}`,
        anchorId: anchor.id,
        tableId,
        kind: definition.kind,
        itemId: definition.kind === ItemKind.WEAPON ? null : definition.id,
        weaponId: definition.kind === ItemKind.WEAPON ? definition.weaponId : null,
        lootId: definition.id,
        quantity: entry.quantity,
        visual: definition.visual,
        tint: definition.tint,
        position: { x, y, z },
        yaw: (anchor.yaw ?? 0) + scatter.yaw,
        state: null,
        slot: null,
        active: true,
        dropped: false,
        spawnOrder: i,
      });
    }
  }

  /** Small deterministic jitter so a building's pickups do not stack. */
  _scatterOffset(anchor, index) {
    const random = new Random(`${this.seed}:scatter:${anchor.id}:${index}`);
    const radius = anchor.indoor ? 1.1 : 1.4;
    return {
      x: random.range(-radius, radius),
      z: random.range(-radius, radius),
      yaw: random.range(-Math.PI, Math.PI),
    };
  }

  // ------------------------------------------------------------ rendering ----

  /** One InstancedMesh per visual part; capacity is exact plus drop headroom. */
  _buildInstances() {
    createLootVisuals();
    const counts = new Map();
    for (const pickup of this.pickups) {
      counts.set(pickup.visual, (counts.get(pickup.visual) ?? 0) + 1);
    }

    for (const [visualId, count] of counts) {
      const visual = getLootVisual(visualId);
      const capacity = count + this.config.dropHeadroom;
      const parts = [];
      for (const visualPart of visual.parts) {
        const mesh = new THREE.InstancedMesh(visualPart.geometry, visualPart.material, capacity);
        mesh.name = `loot-${visualId}-${parts.length}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = !visualPart.material.transparent;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.count = capacity;
        this.group.add(mesh);
        parts.push(mesh);
      }
      this.pools.set(visualId, { id: visualId, capacity, parts, free: [], cursor: 0 });
    }
  }

  /** Assign instance slots and hide every slot that has no pickup yet. */
  _buildIndex() {
    for (const pickup of this.pickups) {
      pickup.slot = this._takeSlot(pickup.visual, pickup);
      this._writeInstance(pickup, 0);
      this._indexPickup(pickup);
    }

    for (const pool of this.pools.values()) {
      for (let slot = 0; slot < pool.capacity; slot += 1) {
        if (!this.pickups.some((pickup) => pickup.visual === pool.id && pickup.slot === slot)) {
          this._hideSlot(pool, slot);
        }
      }
      for (const mesh of pool.parts) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }

  _takeSlot(visualId, pickup) {
    const pool = this.pools.get(visualId);
    if (!pool) return null;
    if (pool.free.length > 0) return pool.free.pop();
    if (pool.cursor < pool.capacity) {
      const slot = pool.cursor;
      pool.cursor += 1;
      return slot;
    }
    // Pool exhausted: recycle the oldest player-dropped pickup so a drop can
    // never grow the scene graph (or the instance buffers) at runtime.
    let victim = null;
    for (const candidate of this.pickups) {
      if (!candidate.active || candidate === pickup || !candidate.dropped) continue;
      if (candidate.visual !== visualId) continue;
      if (!victim || candidate.spawnOrder < victim.spawnOrder) victim = candidate;
    }
    if (!victim) return null;
    const slot = victim.slot;
    victim.slot = null;
    this.takePickup(victim, { silent: true });
    return slot;
  }

  _writeInstance(pickup, time) {
    const pool = this.pools.get(pickup.visual);
    if (!pool || pickup.slot === null) return;
    const bob = Math.sin(time * 2 + pickup.spawnOrder) * 0.045;
    this._tmpVector.set(pickup.position.x, pickup.position.y + bob, pickup.position.z);
    this._tmpQuaternion.setFromAxisAngle(UP, pickup.yaw + (pickup.kind === ItemKind.CONSUMABLE ? time * 0.35 : 0));
    this._tmpScale.setScalar(pickup.active ? 1 : 0);
    this._tmpMatrix.compose(this._tmpVector, this._tmpQuaternion, this._tmpScale);
    for (const mesh of pool.parts) mesh.setMatrixAt(pickup.slot, this._tmpMatrix);
  }

  _hideSlot(pool, slot) {
    this._tmpMatrix.makeScale(0, 0, 0);
    for (const mesh of pool.parts) mesh.setMatrixAt(slot, this._tmpMatrix);
  }

  // ----------------------------------------------------------- spatial hash --

  _cellKey(x, z) {
    const size = this.config.cellSize;
    return `${Math.floor(x / size)}:${Math.floor(z / size)}`;
  }

  _indexPickup(pickup) {
    const key = this._cellKey(pickup.position.x, pickup.position.z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    if (!cell.includes(pickup)) cell.push(pickup);
  }

  _unindexPickup(pickup) {
    const cell = this.cells.get(this._cellKey(pickup.position.x, pickup.position.z));
    if (!cell) return;
    const index = cell.indexOf(pickup);
    if (index >= 0) cell.splice(index, 1);
  }

  /** Nearest active pickup within `radius` of a world position (or null). */
  nearestPickup(position, radius = this.config.interactionRadius) {
    const size = this.config.cellSize;
    const cellX = Math.floor(position.x / size);
    const cellZ = Math.floor(position.z / size);
    let best = null;
    let bestDistance = radius * radius;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cell = this.cells.get(`${cellX + dx}:${cellZ + dz}`);
        if (!cell) continue;
        for (const pickup of cell) {
          if (!pickup.active) continue;
          const ddx = pickup.position.x - position.x;
          const ddy = (pickup.position.y - position.y) * 0.6;
          const ddz = pickup.position.z - position.z;
          const distance = ddx * ddx + ddy * ddy + ddz * ddz;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = pickup;
          }
        }
      }
    }
    return best;
  }

  getPickup(id) {
    return this.pickups.find((pickup) => pickup.id === id) ?? null;
  }

  /** Every pickup within `radius` - used by tests and future minimap markers. */
  pickupsNear(position, radius = 6) {
    return this.pickups.filter(
      (pickup) => pickup.active && Math.hypot(pickup.position.x - position.x, pickup.position.z - position.z) <= radius,
    );
  }

  // --------------------------------------------------------------- mutation --

  /**
   * Remove a pickup from the world and free its instance slot.
   * @returns {object|null} the removed pickup
   */
  takePickup(pickup, { silent = false } = {}) {
    if (!pickup?.active) return null;
    pickup.active = false;
    const pool = this.pools.get(pickup.visual);
    if (pool) {
      if (pickup.slot !== null && pickup.slot !== undefined && !pool.free.includes(pickup.slot)) {
        pool.free.push(pickup.slot);
        this._hideSlot(pool, pickup.slot);
        for (const mesh of pool.parts) mesh.instanceMatrix.needsUpdate = true;
      }
    }
    pickup.slot = null;
    this._unindexPickup(pickup);
    if (!silent) {
      this.bus?.emit('loot:taken', { pickup, id: pickup.id, lootId: pickup.lootId, quantity: pickup.quantity });
    }
    if (this.nearest === pickup) this.nearest = null;
    return pickup;
  }

  /**
   * Spawn a new world pickup - the way a dropped weapon (or a future airdrop)
   * enters the world. Reuses a pooled instance slot, never a fresh mesh.
   *
   * @param {{lootId:string, quantity?:number, position:{x:number,y:number,z:number},
   *          yaw?:number|null, state?:object|null}} options
   *        `state` carries per-instance data (a dropped weapon's magazine) so a
   *        swap is not lossy.
   */
  dropPickup({ lootId, quantity = 1, position, yaw = null, state = null }) {
    const definition = lookupItem(lootId);
    if (!definition) throw new Error(`Cannot drop unknown loot "${lootId}"`);
    if (this.pickups.filter((pickup) => pickup.active).length >= this.config.maxPickups + this.config.dropHeadroom) {
      return null;
    }

    const pickup = {
      id: `drop-${(this._dropCounter = (this._dropCounter ?? 0) + 1)}`,
      anchorId: null,
      tableId: null,
      kind: definition.kind,
      itemId: definition.kind === ItemKind.WEAPON ? null : definition.id,
      weaponId: definition.kind === ItemKind.WEAPON ? definition.weaponId : null,
      lootId: definition.id,
      quantity,
      visual: definition.visual,
      tint: definition.tint,
      position: { x: position.x, y: position.y, z: position.z },
      yaw: yaw ?? 0,
      state,
      slot: null,
      active: true,
      dropped: true,
      spawnOrder: this.pickups.length,
    };
    if (!this.pools.has(pickup.visual)) pickup.visual = 'crate';
    pickup.slot = this._takeSlot(pickup.visual, pickup);
    this.pickups.push(pickup);
    this._indexPickup(pickup);
    this._writeInstance(pickup, 0);
    const pool = this.pools.get(pickup.visual);
    for (const mesh of pool.parts) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.bus?.emit('loot:dropped', { pickup, id: pickup.id, lootId: pickup.lootId, quantity });
    return pickup;
  }

  /** Convenience for a dropped weapon, placed just in front of the player. */
  dropAtFeet(lootId, position, yaw = 0, quantity = 1, state = null) {
    const forward = { x: -Math.sin(yaw) * this.config.dropDistance, z: -Math.cos(yaw) * this.config.dropDistance };
    const x = position.x + forward.x;
    const z = position.z + forward.z;
    const y = this.world.heightAt(x, z);
    return this.dropPickup({ lootId, quantity, position: { x, y, z }, yaw, state });
  }

  /** Human readable prompt data for a pickup (used by the HUD). */
  describe(pickup) {
    if (!pickup) return null;
    if (pickup.kind === ItemKind.WEAPON) {
      const definition = lookupItem(pickup.weaponId);
      return {
        id: pickup.id,
        lootId: pickup.lootId,
        kind: pickup.kind,
        name: definition?.name ?? pickup.weaponId,
        detail: definition?.description ?? '',
        quantity: 1,
      };
    }
    const info = describeItem(pickup.itemId);
    return {
      id: pickup.id,
      lootId: pickup.lootId,
      kind: pickup.kind,
      name: info.name,
      detail: pickup.quantity > 1 ? `x${pickup.quantity}` : '',
      quantity: pickup.quantity,
    };
  }

  // --------------------------------------------------------------- update ----

  fixedUpdate() {
    const player = this.player?.position;
    if (!player) return;
    const nearest = this.nearestPickup(player, this.config.interactionRadius);
    this.nearest = nearest;
    const id = nearest?.id ?? null;
    if (id !== this._lastNearestId) {
      this._lastNearestId = id;
      this.bus.emit('loot:nearby', { pickup: nearest, description: this.describe(nearest) });
    }
  }

  update(dt) {
    this._clock += dt;
    this._animationTimer += dt;
    if (this._animationTimer < this.config.animationInterval) return;
    this._animationTimer = 0;
    const origin = this.player?.position;
    if (!origin) return;
    const radiusSq = this.config.animationRadius * this.config.animationRadius;

    for (const pickup of this.pickups) {
      if (!pickup.active || pickup.slot === null) continue;
      const dx = pickup.position.x - origin.x;
      const dz = pickup.position.z - origin.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      this._writeInstance(pickup, this._clock);
      const pool = this.pools.get(pickup.visual);
      for (const mesh of pool.parts) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const pool of this.pools.values()) {
      for (const mesh of pool.parts) {
        mesh.parent?.remove(mesh);
        mesh.dispose();
      }
    }
    this.pools.clear();
    this.pickups.length = 0;
    this.anchors.length = 0;
    this.cells.clear();
    this.group?.clear();
    this.group?.parent?.remove(this.group);
    this.group = null;
    disposeLootVisuals();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
