import test from 'node:test';
import assert from 'node:assert/strict';

import { Terrain } from '../src/world/Terrain.js';
import { Arena } from '../src/world/Arena.js';
import { Nature } from '../src/world/Nature.js';
import { IslandMap } from '../src/world/IslandMap.js';
import { POI_DEFINITIONS, ROAD_NETWORK, RIVER_PATH, BRIDGE_SITES, MOUNTAIN_RANGES } from '../src/world/MapData.js';
import { Collider, BoxBlocker, CircleBlocker } from '../src/physics/Collider.js';
import { RayWorldSpawnTester } from '../src/world/SpawnTester.js';
import { WORLD, PLAYER, TERRAIN, getQualitySettings } from '../src/config/settings.js';

const quality = getQualitySettings('mobile');

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

test('terrain is deterministic for a given seed across island-scale coordinates', () => {
  const a = createTerrain();
  const b = createTerrain();
  for (let i = 0; i < 50; i += 1) {
    const x = (i * 137) % 3500 - 1750;
    const z = (i * 193) % 3500 - 1750;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  }
});

test('different seeds produce different terrain while retaining authored mountains', () => {
  const a = createTerrain('seed-a');
  const b = createTerrain('seed-b');
  let differences = 0;
  for (let i = 0; i < 25; i += 1) {
    const x = 260 + i * 43;
    const z = -400 + i * 31;
    if (Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) > 0.05) differences += 1;
  }
  assert.ok(differences > 20, `expected the seeds to differ, got ${differences}/25`);
  assert.ok(Math.max(...MOUNTAIN_RANGES.map((range) => a.heightAt(...range.center))) > 150);
});

test('the 4 km island has a graded city terrace, coastline, beaches, ocean and a river valley', () => {
  const terrain = createTerrain();
  assert.equal(terrain.size, WORLD.size);
  const cityHeight = terrain.heightAt(0, 0);
  assert.equal(terrain.heightAt(12, 0), cityHeight, 'the arrival plaza is on the central-city terrace');
  assert.equal(terrain.heightAt(0, -24), cityHeight, 'the POI interior is buildable');
  assert.ok(terrain.slopeAt(32, 27) < 0.01, 'the city pad is level');

  assert.equal(terrain.isLandAt(0, 0), true);
  assert.equal(terrain.isLandAt(2050, 0), false, 'the east coast ends before the square mesh edge');
  assert.ok(terrain.heightAt(2500, 0) < TERRAIN.seaLevel, 'the surrounding seabed sits below sea level');
  const coast = terrain.coastlineRadiusAt(0);
  assert.ok(terrain.heightAt(coast - 20, 0) > TERRAIN.seaLevel, 'the shore grades into a walkable beach');
  assert.ok(terrain.heightAt(coast + 100, 0) < TERRAIN.seaLevel, 'the land transitions to shallow water');

  const [riverX, riverZ] = RIVER_PATH[7];
  assert.ok(
    terrain.heightAt(riverX, riverZ) < terrain.heightAt(riverX + 44, riverZ + 44),
    'the river is cut below its banks',
  );
  assert.ok(Number.isFinite(terrain.riverSurfaceAt(riverX, riverZ)));
  let upstream = Infinity;
  for (const [x, z] of RIVER_PATH) {
    const water = terrain.riverSurfaceAt(x, z);
    assert.ok(water < upstream, 'the river profile descends toward the coast');
    assert.ok(terrain.heightAt(x, z) < water, 'the water ribbon sits above its analytic channel bed');
    upstream = water;
  }
  const [mouthX, mouthZ] = RIVER_PATH.at(-1);
  assert.ok(terrain.heightAt(mouthX, mouthZ) < terrain.riverSurfaceAt(mouthX, mouthZ));
});

test('the one-time arrival plaza spawn points are on walkable clear ground', () => {
  const { terrain, arena, collider } = createWorld();
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };
  assert.equal(arena.spawnPoints.length, 8);
  assert.equal(arena.boxes.length, 0, 'the arrival plaza is not enclosed by an arena wall');

  for (const point of arena.spawnPoints) {
    const y = terrain.heightAt(point.x, point.z);
    assert.ok(collider.isClear(point.x, point.z, y, body), `spawn ${point.x},${point.z} is blocked`);
  }
});

test('island foliage is deterministic, clustered in biomes, and kept off roads and settlements', () => {
  const { nature, terrain } = createWorld();
  const repeatNature = new Nature({ world: WORLD, terrain: createTerrain(), quality }).build();
  assert.deepEqual(
    nature.cylinders.map(({ name, x, z }) => [name, x, z]),
    repeatNature.cylinders.map(({ name, x, z }) => [name, x, z]),
    'a fixed map seed recreates the same nature blockers',
  );
  repeatNature.dispose();
  assert.ok(nature.counts.trees > 80, `expected forest instances, got ${nature.counts.trees}`);
  assert.ok(nature.counts.rocks > 40, `expected ridge rocks, got ${nature.counts.rocks}`);
  assert.ok(nature.counts.grass > 100, `expected field tufts, got ${nature.counts.grass}`);

  for (const cylinder of nature.cylinders) {
    assert.ok(terrain.isLandAt(cylinder.x, cylinder.z, 2), `${cylinder.name} must be on island ground`);
    assert.ok(terrain.slopeAt(cylinder.x, cylinder.z) < 0.82, `${cylinder.name} is on an unclimbable face`);
  }
  const forestTrees = nature.cylinders.filter((cylinder) => cylinder.name === 'tree');
  assert.ok(forestTrees.length > 50);
  assert.ok(
    forestTrees.some((tree) => Math.hypot(tree.x + 1050, tree.z + 900) < 430),
    'the Pinewatch forest patch contains trees',
  );
});

test('all ten POIs build original structures, identifiable landmarks, roads and collision', () => {
  const terrain = createTerrain();
  const map = new IslandMap({ terrain, quality }).build();
  assert.equal(POI_DEFINITIONS.length, 10);
  assert.equal(new Set(map.poiCatalog.map((poi) => poi.name)).size, 10, 'POI names are unique');
  assert.equal(new Set(map.poiCatalog.map((poi) => poi.landmarkName)).size, 10, 'landmarks are unique');
  assert.ok(map.poiCatalog.every((poi) => poi.structureCount >= 6), 'each named POI has multiple structures');
  assert.ok(map.buildingCount >= 65, `multiple structures at each POI (${map.buildingCount})`);
  assert.equal(map.landmarkCount, 10);
  assert.ok(map.boxes.length > 250, `building/bridge/cover collision registered (${map.boxes.length})`);
  assert.ok(map.cylinders.length > 15, 'landmark towers and stacks collide');
  assert.equal(map.group.children.filter((child) => child.name.startsWith('road-')).length, ROAD_NETWORK.length);
  assert.ok(map.group.children.some((child) => child.name === 'willow-run-river'));
  assert.ok(map.group.children.some((child) => child.name === 'surrounding-ocean'));

  const wall = map.boxes.find((box) => box.name.startsWith('central-city-0-rear'));
  assert.ok(wall, 'buildings expose real collision walls');
  const collider = new Collider({ heightSampler: terrain, boxes: map.boxes, cylinders: map.cylinders });
  assert.equal(collider.pointBlocked(wall.center.x, wall.center.y, wall.center.z, 0), true, 'shot/camera probes see the wall');
  assert.ok(map.boxes.some((box) => box.name.startsWith('bridge-willow-span-deck')), 'the river bridge is collidable');
});

test('bridge decks span the valleys and both stair approaches meet natural ground', () => {
  const terrain = createTerrain();
  const map = new IslandMap({ terrain, quality }).build();

  for (const bridge of BRIDGE_SITES) {
    const deck = map.boxes.find((box) => box.name === `bridge-${bridge.id}-deck`);
    assert.ok(deck?.walkable, `${bridge.id} deck has actor collision`);
    const steps = map.boxes.filter((box) => box.name === `bridge-${bridge.id}-approach-step`);
    const project = (box) => (box.center.x - bridge.center[0]) * -Math.sin(bridge.yaw)
      + (box.center.z - bridge.center[1]) * Math.cos(bridge.yaw);

    for (const side of [-1, 1]) {
      const approach = steps
        .filter((box) => Math.sign(project(box)) === side)
        .sort((a, b) => Math.abs(project(a)) - Math.abs(project(b)));
      assert.ok(approach.length >= 5, `${bridge.id} has a ramp on side ${side}`);
      assert.ok(Math.abs(approach[0].topY - deck.topY) < 1e-6, 'first tread joins the deck');
      for (let i = 1; i < approach.length; i += 1) {
        const rise = approach[i - 1].topY - approach[i].topY;
        assert.ok(rise >= 0 && rise <= PLAYER.stepHeight, `${bridge.id} has traversable tread heights`);
      }
      const outer = approach.at(-1);
      const bankGround = terrain.heightAt(outer.center.x, outer.center.z);
      assert.ok(Math.abs(bankGround - outer.topY) < 0.6, `${bridge.id} ramp meets the valley bank`);
    }
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
  assert.equal(box.overlapsFootprint(position.x, position.z, radius - 1e-3), false);
  const before = { ...position };
  box.pushOut(position, radius, { pushed: false, nx: 0, nz: 0, push: 0 });
  assert.ok(Math.hypot(position.x - before.x, position.z - before.z) < 1e-9);
});

test('spatial broadphase preserves collision and dynamically registers removable target cylinders', () => {
  const heightSampler = { heightAt: () => 0 };
  const boxes = [];
  for (let i = 0; i < 180; i += 1) {
    boxes.push(new BoxBlocker({
      center: { x: 1200 + i * 30, y: 1, z: -900 },
      size: { x: 4, y: 2, z: 4 },
    }));
  }
  const collider = new Collider({ heightSampler, boxes });
  const localWall = new BoxBlocker({ center: { x: 0, y: 1, z: -3 }, size: { x: 2, y: 2, z: 0.5 } });
  collider.boxes.push(localWall);
  collider._indexBox(localWall);
  assert.equal(collider.pointBlocked(0, 1, -3), true, 'nearby box is indexed');
  assert.ok(collider._boxCandidates.length < 5, 'a local probe does not walk every island collider');

  const target = new CircleBlocker({ x: 5, z: 0, radius: 0.6, height: 1.8, name: 'target-test' });
  const body = { radius: 0.36, height: 1.8, stepHeight: 0.5 };
  assert.equal(collider.isClear(5, 0, 0, body), true);
  collider.addCylinder(target);
  assert.equal(collider.isClear(5, 0, 0, body), false);
  assert.equal(collider.removeCylinder(target), true);
  assert.equal(collider.isClear(5, 0, 0, body), true, 'removal updates collision immediately');
});

test('cylinders block an approach and walkable boxes act as floors', () => {
  const heightSampler = { heightAt: () => 0 };
  const radius = 0.36;
  const box = new BoxBlocker({
    center: { x: 0, y: 0.5, z: -3 },
    size: { x: 2, y: 1, z: 2 },
    walkable: true,
  });
  const cylinder = new CircleBlocker({ x: 4, z: 0, radius: 0.5, height: 3 });
  const collider = new Collider({ heightSampler, boxes: [box], cylinders: [cylinder] });
  const body = { radius, height: 1.8, stepHeight: 0.5 };

  const onGround = { x: 0, y: 0, z: -2.1 };
  collider.resolveHorizontal(onGround, body);
  assert.ok(onGround.z >= -2 + radius - 1e-6, `pushed out, z=${onGround.z}`);
  assert.equal(box.overlapsFootprint(onGround.x, onGround.z, radius - 1e-3), false);
  assert.equal(collider.groundHeightAt(onGround.x, onGround.z, 0, body), 0);

  const onTop = { x: 0, y: 1, z: -3 };
  collider.resolveHorizontal(onTop, body);
  assert.equal(onTop.x, 0);
  assert.equal(onTop.z, -3);
  assert.equal(collider.groundHeightAt(0, -3, 1, body), 1);

  const nearCylinder = { x: 4.2, y: 0, z: 0 };
  collider.resolveHorizontal(nearCylinder, body);
  assert.equal(cylinder.overlapsFootprint(nearCylinder.x, nearCylinder.z, radius - 1e-3), false);
});

test('ground sampling follows the analytic terrain across hills and valleys', () => {
  const { terrain, collider } = createWorld();
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };
  for (const [x, z] of [[180, 210], [-480, 770], [1240, 950], [1420, -600]]) {
    assert.equal(collider.groundHeightAt(x, z, terrain.heightAt(x, z), body), terrain.heightAt(x, z));
  }
});

test('the spawn tester accepts the entry plaza and rejects ocean or a blocked footprint', () => {
  const terrain = createTerrain();
  const spawn = new Arena({ world: WORLD, terrain, quality }).build().spawnPoints[0];
  const body = { radius: PLAYER.radius, height: PLAYER.height, stepHeight: PLAYER.stepHeight };
  const blockingBox = new BoxBlocker({
    center: { x: spawn.x, y: terrain.heightAt(spawn.x, spawn.z) + 1, z: spawn.z },
    size: { x: 2, y: 2, z: 2 },
  });
  const collider = new Collider({ heightSampler: terrain, boxes: [blockingBox] });
  const world = {
    terrain,
    collider,
    heightAt: (x, z) => terrain.heightAt(x, z),
    slopeAt: (x, z) => terrain.slopeAt(x, z),
    isInside: (x, z) => terrain.isLandAt(x, z, 1),
    isWithinBounds: (x, z, radius = 0) => Math.hypot(x, z) <= WORLD.playableRadius - radius && terrain.isLandAt(x, z, radius),
  };
  const tester = new RayWorldSpawnTester({ world });

  const clearSpawn = { x: 0, y: 0, z: 6.2 };
  assert.equal(tester.test(clearSpawn, body), true);
  assert.equal(clearSpawn.y, terrain.heightAt(clearSpawn.x, clearSpawn.z), 'spawn snaps to analytic ground');
  assert.equal(tester.test({ x: 0, y: 0, z: 2000 }, body), false, 'ocean is not a spawn surface');
  assert.equal(tester.test({ x: spawn.x, y: 0, z: spawn.z }, body), false, 'solid geometry rejects a spawn');
});

test('every authored POI plateau is level enough for its building footprint', () => {
  const terrain = createTerrain();
  for (const poi of POI_DEFINITIONS) {
    const [x, z] = poi.center;
    assert.ok(terrain.isLandAt(x, z, poi.radius * 0.65), `${poi.name} sits inland`);
    assert.ok(terrain.slopeAt(x, z) < 0.02, `${poi.name} has a buildable center`);
    assert.ok(Number.isFinite(terrain.heightAt(x, z)));
  }
});
