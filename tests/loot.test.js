import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { LootSystem } from '../src/loot/LootSystem.js';
import { LOOT } from '../src/config/settings.js';
import { EventBus } from '../src/core/events.js';
import { listLootVisualIds } from '../src/loot/LootVisuals.js';

/**
 * LootSystem unit tests against a stub world.
 *
 * The point of these is the *world entity* behaviour: spawning from anchors,
 * instanced rendering, the spatial hash, pickup/drop and recycling - all without
 * a GPU, a DOM or the full game.
 */

const PLAYER = { position: { x: 0, y: 0.9, z: 0 } };

/** Minimal world that satisfies what the loot system reads. */
function stubWorld({ anchors = [], clear = true, inside = true } = {}) {
  return {
    lootAnchors: anchors,
    heightAt: () => 0,
    slopeAt: () => 0,
    groundHeightAt: () => 0,
    isWithinBounds: () => inside,
    collider: { isClear: () => clear },
  };
}

function createLoot({ anchors = [], seed = 'test-seed', world = null, player = PLAYER, config = LOOT } = {}) {
  const bus = new EventBus();
  const renderer = { worldGroup: new THREE.Group() };
  const worldStub = world ?? stubWorld({ anchors });
  const services = {
    require: (name) => {
      if (name === 'world') return worldStub;
      if (name === 'renderer') return renderer;
      throw new Error(`unexpected service ${name}`);
    },
    get: (name) => (name === 'player' ? player : null),
  };
  const loot = new LootSystem({ config, seed });
  loot.init({ bus, services });
  return { loot, bus, renderer, world: worldStub };
}

/** A handful of hand-written anchors (no map generation needed). */
function anchors(count = 12) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    list.push({
      id: `anchor-${i}`,
      kind: i % 3 === 0 ? 'military' : i % 3 === 1 ? 'house' : 'crate',
      indoor: i % 2 === 0,
      position: { x: 20 + i * 7, y: 0, z: i * 4 },
      yaw: i * 0.3,
    });
  }
  return list;
}

test('loot spawns from world anchors and lives in the world, not in metadata', () => {
  const { loot } = createLoot({ anchors: anchors(12) });

  assert.ok(loot.pickups.length > 12, `expected items from the anchors, got ${loot.pickups.length}`);
  assert.ok(loot.anchors.length > 0);
  for (const pickup of loot.pickups) {
    assert.equal(pickup.active, true);
    assert.ok(pickup.lootId, 'every pickup has a loot id');
    assert.ok(Number.isFinite(pickup.position.x) && Number.isFinite(pickup.position.z));
    assert.equal(typeof pickup.quantity, 'number');
    assert.ok(pickup.quantity >= 1);
  }

  // Anchors are validated: nothing spawns inside geometry...
  const blocked = createLoot({ anchors: anchors(4), world: stubWorld({ anchors: anchors(4), clear: false }) });
  assert.equal(blocked.loot.anchors.length, 0, 'a blocked world spawns no loot at all');
  assert.equal(blocked.loot.pickups.length, 0);

  // ...or off the island.
  const offMap = createLoot({ anchors: anchors(4), world: stubWorld({ anchors: anchors(4), inside: false }) });
  assert.equal(offMap.loot.anchors.length, 0, 'no anchors survive an out-of-bounds world');
});

test('the arrival plaza always carries a playable starting kit', () => {
  const { loot } = createLoot({ anchors: [] });

  const weapons = loot.pickups.filter((pickup) => pickup.kind === 'weapon');
  const ammo = loot.pickups.filter((pickup) => pickup.kind === 'ammo');
  const consumables = loot.pickups.filter((pickup) => pickup.kind === 'consumable');

  assert.ok(weapons.length >= 1, 'a rifle is waiting at the plaza');
  assert.ok(ammo.length >= 1, 'with ammunition');
  assert.ok(consumables.length >= 1, 'and a consumable');
  assert.ok(loot.anchors.every((anchor) => Math.hypot(anchor.position.x, anchor.position.z) < 40));
});

test('rendering is instanced: a handful of meshes for hundreds of pickups', () => {
  const { loot, renderer } = createLoot({ anchors: anchors(140) });

  assert.ok(loot.pickups.length > 150, `expected a lot of pickups, got ${loot.pickups.length}`);
  assert.ok(loot.stats.instancedMeshes < 40, `too many meshes: ${loot.stats.instancedMeshes}`);
  assert.equal(loot.group.children.length, loot.stats.instancedMeshes);
  assert.ok(
    loot.group.children.every((child) => child.isInstancedMesh),
    'every loot mesh is an InstancedMesh',
  );

  // Capacities cover the map plus drop headroom without ever being unbounded.
  for (const pool of loot.pools.values()) {
    assert.ok(pool.capacity <= pool.cursor + LOOT.dropHeadroom + 1);
  }
  const totalInstances = [...loot.pools.values()].reduce((sum, pool) => sum + pool.capacity, 0);
  assert.ok(totalInstances < loot.pickups.length + LOOT.dropHeadroom * loot.pools.size + 1);
  assert.ok(renderer.worldGroup.getObjectByName('loot'), 'the loot group is in the scene');
});

test('pickups are found through the spatial hash in constant time', () => {
  const { loot } = createLoot({ anchors: anchors(12) });
  const target = loot.pickups.find((pickup) => pickup.active);

  const near = { x: target.position.x + 0.5, y: target.position.y, z: target.position.z };
  const found = loot.nearestPickup(near, LOOT.interactionRadius);
  assert.ok(found, 'a pickup is found next to the player');
  assert.equal(
    Math.hypot(found.position.x - near.x, found.position.z - near.z) <= LOOT.interactionRadius,
    true,
  );

  // Nothing within the radius of an empty stretch of map.
  const empty = loot.nearestPickup({ x: 9000, y: 0, z: 9000 }, LOOT.interactionRadius);
  assert.equal(empty, null);

  // Radius is respected exactly.
  const justOutside = loot.nearestPickup({ x: target.position.x + 6, y: 0, z: target.position.z + 6 }, 1);
  assert.equal(justOutside, null);
});

test('taking a pickup removes it from the world and frees its instance slot', () => {
  const { loot, bus } = createLoot({ anchors: anchors(8) });
  const taken = [];
  bus.on('loot:taken', (payload) => taken.push(payload));

  const pickup = loot.pickups[0];
  const pool = loot.pools.get(pickup.visual);
  const slot = pickup.slot;

  const removed = loot.takePickup(pickup);
  assert.equal(removed, pickup);
  assert.equal(pickup.active, false);
  assert.equal(pool.free.includes(slot), true, 'the instance slot is pooled again');
  assert.equal(loot.nearestPickup(pickup.position, 1), null, 'it is no longer findable');
  assert.equal(taken.length, 1);
  assert.equal(loot.takePickup(pickup), null, 'taking twice is a no-op');
});

test('dropping a weapon creates a real pickup that reuses a pooled instance', () => {
  const { loot, bus } = createLoot({ anchors: anchors(6) });
  const meshesBefore = loot.group.children.length;
  const droppedEvents = [];
  bus.on('loot:dropped', (payload) => droppedEvents.push(payload));

  const created = loot.dropAtFeet('rifle', { x: 2, y: 0, z: 2 }, 0, 1, { magazine: 17 });

  assert.ok(created, 'the drop exists in the world');
  assert.equal(created.dropped, true);
  assert.equal(created.lootId, 'rifle');
  assert.equal(created.state.magazine, 17, 'the magazine state travels with the drop');
  assert.equal(loot.group.children.length, meshesBefore, 'no new mesh was created');
  assert.equal(droppedEvents.length, 1);

  // And it can be picked up again exactly like map loot.
  const found = loot.nearestPickup(loot.getPickup(created.id).position, 1);
  assert.equal(found?.id, created.id);

  const description = loot.describe(created);
  assert.equal(description.kind, 'weapon');
  assert.equal(description.name, 'AR-4 Ranger');
});

test('the pickup pool never grows past its headroom (drops recycle the oldest)', () => {
  const { loot } = createLoot({ anchors: anchors(3), config: { ...LOOT, dropHeadroom: 4, maxPickups: 40 } });
  const before = loot.group.children.length;

  for (let i = 0; i < 12; i += 1) {
    loot.dropAtFeet('mushroom', { x: 30 + i, y: 0, z: 30 }, 0, 1);
  }

  assert.equal(loot.group.children.length, before, 'instance meshes are fixed');
  for (const pool of loot.pools.values()) {
    assert.ok(pool.capacity < loot.pickups.length + LOOT.dropHeadroom + 20);
  }
  assert.ok(loot.pickups.filter((pickup) => pickup.active).length < 12 + 40);
});

test('the loot layout is deterministic for a seed and differs across seeds', () => {
  const layout = (seed) => {
    const { loot } = createLoot({ anchors: anchors(20), seed });
    return loot.pickups.map((pickup) => `${pickup.lootId}:${pickup.quantity}@${pickup.position.x.toFixed(2)}`);
  };

  assert.deepEqual(layout('same'), layout('same'), 'a seed reproduces the map layout');
  assert.notDeepEqual(layout('same'), layout('different'), 'a different seed reshuffles it');
});

test('the loot cap protects the frame budget on huge maps', () => {
  const { loot } = createLoot({ anchors: anchors(400), config: { ...LOOT, maxPickups: 25 } });
  assert.equal(loot.pickups.length, 25);
});

test('proximity prompts are published once per change, not every frame', () => {
  const player = { position: { x: 0, y: 0, z: 0 } };
  const { loot, bus } = createLoot({ anchors: anchors(4), player });

  const events = [];
  bus.on('loot:nearby', (payload) => events.push(payload));

  loot.fixedUpdate();
  assert.equal(events.length, 0, 'an empty neighbourhood publishes nothing');

  const target = loot.pickups.find((pickup) => pickup.active);
  player.position.x = target.position.x + 0.4;
  player.position.z = target.position.z + 0.4;
  loot.fixedUpdate();
  loot.fixedUpdate();
  loot.fixedUpdate();

  assert.equal(events.length, 1, 'only the change is published');
  assert.equal(events[0].pickup.id, target.id);
  assert.ok(events[0].description.name, 'the prompt carries a human readable name');
});

test('loot visuals are a small, fixed set of instanced parts', () => {
  const ids = listLootVisualIds();
  assert.ok(ids.includes('weapon'));
  assert.ok(ids.includes('mushroom'));
  assert.ok(ids.includes('inhaler'));
  assert.ok(ids.includes('ammo-box'));
  assert.ok(ids.length < 12, `expected a compact visual set, got ${ids.length}`);
});
