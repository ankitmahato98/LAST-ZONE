import test from 'node:test';
import assert from 'node:assert/strict';

import { Terrain } from '../src/world/Terrain.js';
import { Arena } from '../src/world/Arena.js';
import { Nature } from '../src/world/Nature.js';
import { Collider, BoxBlocker, CircleBlocker } from '../src/physics/Collider.js';
import { RayWorldSpawnTester } from '../src/world/SpawnTester.js';
import { WORLD, PLAYER, TERRAIN, getQualitySettings } from '../src/config/settings.js';

const quality = getQualitySettings('mobile'); // small map, fast tests

function createTerrain(seed = WORLD.seed) {
  return new Terrain({ world: { ...WORLD, seed }, quality });
}

function createWorld(seed = WORLD.seed) {
  const terrain = createTerrain(seed);
  const arena = new Arena({ world: { ...WORLD, seed }, terrain, quality }).build();
  const nature = new Nature({ world: { ...WORLD, seed }, terrain, quality }).build();
  const collider = new Collider({
    heightSampler: terrain,
    boxes: arena.boxes,
    cylinders: [...arena.cylinders, ...nature.cylinders],
    worldLimit: WORLD.playableRadius,
  });
  return { terrain, arena, nature, collider };
}

test('terrain is deterministic for a given seed', () => {
  const a = createTerrain();
  const b = createTerrain();
  for (let i = 0; i < 50; i += 1) {
    const x = (i * 37) % 180 - 90;
    const z = (i * 53) % 180 - 90;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  }
});

test('different seeds produce different worlds', () => {
  const a = createTerrain('seed-a');
  const b = createTerrain('seed-b');
  let differences = 0;
  for (let i = 0; i < 25; i += 1) {
    const x = 60 + i * 3;
    const z = 40 - i * 2;
    if (Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) > 0.05) differences += 1;
  }
  assert.ok(differences > 20, `expected the seeds to differ, got ${differences}/25`);
});

test('the arena floor is flat and the rim closes the map', () => {
  const terrain = createTerrain();
  assert.equal(terrain.heightAt(0, 0), 0);
  assert.equal(terrain.heightAt(12, 0), 0);
  assert.equal(terrain.heightAt(0, -20), 0);
  assert.ok(terrain.slopeAt(15, 15) < 0.01, 'arena should be walkable');
  assert.ok(terrain.heightAt(200, 0) > 20, 'the rim should rise into mountains');
});

test('spawn points are on the ground and free of obstacles', () => {
  const { terrain, arena, collider } = createWorld();
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };

  for (const plate of arena.spawnPoints) {
    const y = terrain.heightAt(plate.x, plate.z);
    assert.ok(collider.isClear(plate.x, plate.z, y, body), `spawn ${plate.x},${plate.z} is blocked`);
  }
});

test('props are scattered outside the arena and inside the map', () => {
  const { nature, terrain } = createWorld();
  assert.ok(nature.counts.trees > 10, 'expected trees');
  assert.ok(nature.counts.rocks > 10, 'expected rocks');

  for (const cylinder of nature.cylinders) {
    const distance = Math.hypot(cylinder.x, cylinder.z);
    assert.ok(distance >= 30, `prop too close to the arena: ${distance.toFixed(1)}`);
    assert.ok(distance <= 170, `prop outside the map: ${distance.toFixed(1)}`);
    assert.ok(terrain.slopeAt(cylinder.x, cylinder.z) < 0.55, 'prop on a cliff');
  }
});

test('box blockers push an actor out, including when rotated', () => {
  const radius = 0.36;
  const box = new BoxBlocker({
    center: { x: 0, y: 1, z: 0 },
    size: { x: 4, y: 2, z: 4 },
    yaw: Math.PI / 4,
  });
  const position = { x: 0.2, y: 0, z: 0.2 };

  assert.equal(box.overlapsFootprint(position.x, position.z, radius), true, 'starts inside');
  const result = { pushed: false, nx: 0, nz: 0, push: 0 };
  assert.equal(box.pushOut(position, radius, result), true);
  // Push-out lands the circle exactly on the surface, so compare with a
  // slightly smaller probe radius.
  assert.equal(
    box.overlapsFootprint(position.x, position.z, radius - 1e-3),
    false,
    `pushed clear of the box (at ${position.x.toFixed(2)}, ${position.z.toFixed(2)})`,
  );

  // Resolving again must not move a body that is already resting on the
  // surface (touching exactly counts as contact, so the push is zero length).
  const before = { ...position };
  box.pushOut(position, radius, { pushed: false, nx: 0, nz: 0, push: 0 });
  assert.ok(Math.hypot(position.x - before.x, position.z - before.z) < 1e-9, 'no second push');
});

test('cylinders block an approach and walkable boxes act as floors', () => {
  const heightSampler = { heightAt: () => 0 };
  const radius = 0.36;
  // Crate: 2x1x2 centred at z = -3, so it spans z in [-4, -2] and tops out at 1.
  const box = new BoxBlocker({
    center: { x: 0, y: 0.5, z: -3 },
    size: { x: 2, y: 1, z: 2 },
    walkable: true,
  });
  const cylinder = new CircleBlocker({ x: 4, z: 0, radius: 0.5, height: 3 });
  const collider = new Collider({ heightSampler, boxes: [box], cylinders: [cylinder] });
  const body = { radius, height: 1.8, stepHeight: 0.5 };

  // Standing on the ground, the crate is a wall: the actor is pushed clear.
  const onGround = { x: 0, y: 0, z: -2.1 };
  collider.resolveHorizontal(onGround, body);
  assert.ok(onGround.z >= -2 + radius - 1e-6, `pushed out towards -1.64, z=${onGround.z}`);
  assert.equal(box.overlapsFootprint(onGround.x, onGround.z, radius - 1e-3), false);
  assert.equal(collider.groundHeightAt(onGround.x, onGround.z, 0, body), 0, 'still on the terrain');

  // At crate height the same box becomes a floor and stops blocking.
  const onTop = { x: 0, y: 1, z: -3 };
  collider.resolveHorizontal(onTop, body);
  assert.equal(onTop.x, 0);
  assert.equal(onTop.z, -3);
  assert.equal(collider.groundHeightAt(0, -3, 1, body), 1);

  // Cylinder push-out.
  const nearCylinder = { x: 4.2, y: 0, z: 0 };
  collider.resolveHorizontal(nearCylinder, body);
  assert.equal(
    cylinder.overlapsFootprint(nearCylinder.x, nearCylinder.z, radius - 1e-3),
    false,
    'pushed out of the cylinder',
  );
});

test('ground sampling follows the terrain', () => {
  const { terrain, collider } = createWorld();
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };
  for (const [x, z] of [[60, 20], [-45, 80], [10, -110], [140, 140]]) {
    assert.equal(collider.groundHeightAt(x, z, terrain.heightAt(x, z), body), terrain.heightAt(x, z));
  }
});

test('the spawn tester rejects water-level terrain and obstacles, accepts flat ground', () => {
  const { terrain, arena, collider } = createWorld();
  const world = {
    terrain,
    collider,
    heightAt: (x, z) => terrain.heightAt(x, z),
    slopeAt: (x, z) => terrain.slopeAt(x, z),
    isInside: (x, z) => terrain.isInside(x, z, 1),
    isWithinBounds: (x, z) => Math.hypot(x, z) <= WORLD.playableRadius,
  };
  const tester = new RayWorldSpawnTester({ world });
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };

  const good = { x: arena.spawnPoints[0].x, y: 0, z: arena.spawnPoints[0].z };
  assert.equal(tester.test(good, body), true);
  assert.equal(good.y, 0, 'the spawn should be snapped to the ground');

  const outside = { x: 1e4, y: 0, z: 0 };
  assert.equal(tester.test(outside, body), false);

  const inTheWall = { x: arena.boxes[0].center.x, y: 0, z: arena.boxes[0].center.z };
  assert.equal(tester.test(inTheWall, body), false);
});

test('the terrain config keeps the arena flat over its whole radius', () => {
  const terrain = createTerrain();
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    const x = Math.cos(angle) * (TERRAIN.flatRadius - 2);
    const z = Math.sin(angle) * (TERRAIN.flatRadius - 2);
    assert.equal(terrain.heightAt(x, z), 0);
  }
});
