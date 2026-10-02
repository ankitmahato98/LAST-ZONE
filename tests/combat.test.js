import test from 'node:test';
import assert from 'node:assert/strict';

import { Health } from '../src/combat/Health.js';
import { Damageable } from '../src/combat/Damageable.js';
import { Collider, BoxBlocker, CircleBlocker } from '../src/physics/Collider.js';
import {
  applySpread,
  pointAt,
  rayActors,
  rayBox,
  rayCylinder,
  raySphere,
  rayWorld,
  surfaceNormal,
  traceShot,
} from '../src/combat/Hitscan.js';
import { Weapon } from '../src/combat/weapons/Weapon.js';
import { createWeapon, getWeaponType, listWeaponIds, registerWeaponType } from '../src/combat/weapons/WeaponTypes.js';
import { createWeaponModel } from '../src/combat/weapons/WeaponModels.js';
import { TrainingDummy } from '../src/combat/Target.js';
import { Random } from '../src/utils/rng.js';
import { COMBAT, WEAPONS } from '../src/config/settings.js';

const UP = { x: 0, y: 1, z: 0 };
const FORWARD = { x: 0, y: 0, z: -1 };

function dummy(overrides = {}) {
  return new Damageable({
    id: 'dummy',
    position: { x: 0, y: 0, z: -10 },
    radius: 0.45,
    height: 1.75,
    ...overrides,
  });
}

// ===========================================================================
// Health
// ===========================================================================

test('health tracks damage, death and healing', () => {
  const health = new Health({ max: 100 });
  assert.equal(health.current, 100);
  assert.equal(health.fraction, 1);

  const first = health.applyDamage(30);
  assert.deepEqual(
    { applied: first.applied, killed: first.killed, ignored: first.ignored },
    { applied: 30, killed: false, ignored: false },
  );
  assert.equal(health.current, 70);
  assert.ok(Math.abs(health.fraction - 0.7) < 1e-9);

  const fatal = health.applyDamage(500);
  assert.equal(fatal.applied, 70, 'damage is clamped to the remaining health');
  assert.equal(fatal.absorbed, 430);
  assert.equal(fatal.killed, true);
  assert.equal(health.current, 0);
  assert.equal(health.dead, true);
  assert.equal(health.alive, false);
});

test('health ignores damage when dead, invulnerable or non-positive', () => {
  const health = new Health({ max: 50 });
  health.setInvulnerable(true);
  assert.equal(health.applyDamage(10).ignored, true);
  assert.equal(health.current, 50);

  health.setInvulnerable(false);
  assert.equal(health.applyDamage(0).ignored, true);
  assert.equal(health.applyDamage(-5).ignored, true);

  health.applyDamage(50);
  assert.equal(health.dead, true);
  assert.equal(health.applyDamage(10).ignored, true, 'no damage after death');
});

test('health heals up to the maximum and can be reset', () => {
  const health = new Health({ max: 100 });
  health.applyDamage(60);
  assert.equal(health.heal(20), 20);
  assert.equal(health.current, 60);
  assert.equal(health.heal(1000), 40, 'healing never exceeds the maximum');
  assert.equal(health.current, 100);

  health.applyDamage(100);
  health.reset();
  assert.equal(health.current, 100);
  assert.equal(health.alive, true);
});

test('health emits damaged, died and healed events', () => {
  const health = new Health({ max: 30 });
  const seen = [];
  health.on('damaged', ({ applied }) => seen.push(`damaged:${applied}`));
  health.on('died', () => seen.push('died'));
  health.on('healed', ({ amount }) => seen.push(`healed:${amount}`));

  health.applyDamage(10, { source: 'test' });
  health.heal(5);
  health.applyDamage(40); // 25 -> 0

  assert.deepEqual(seen, ['damaged:10', 'healed:5', 'damaged:25', 'died']);
});

// ===========================================================================
// Damageable
// ===========================================================================

test('a damageable exposes a cylinder hitbox that follows its position', () => {
  const position = { x: 1, y: 2, z: 3 };
  const actor = dummy({ position });
  assert.deepEqual(actor.center, { x: 1, y: 2 + 1.75 * 0.5, z: 3 });
  assert.equal(actor.headY, 2 + 1.75 * 0.84);

  position.x = 50;
  assert.equal(actor.center.x, 50, 'the hitbox tracks the live position reference');
  assert.equal(actor.isHeadshot(actor.headY + 0.01), true);
  assert.equal(actor.isHeadshot(actor.headY - 0.01), false);
});

test('a disabled damageable is not hittable', () => {
  const actor = dummy();
  actor.enabled = false;
  assert.equal(actor.alive, false);
  const result = actor.takeDamage(50);
  assert.equal(result.ignored, true);
  assert.equal(actor.health.current, 100);
});

// ===========================================================================
// Hitscan primitives
// ===========================================================================

test('ray/sphere intersection finds near hits and rejects misses', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const center = { x: 0, y: 0, z: -10 };
  const hit = raySphere(origin, FORWARD, center, 1);
  assert.ok(Math.abs(hit - 9) < 1e-6, `expected 9, got ${hit}`);
  assert.equal(raySphere(origin, { x: 0, y: 1, z: 0 }, center, 1), -1);
  assert.equal(raySphere(origin, { x: -0, y: 0, z: 1 }, center, 1), -1, 'behind the origin');
});

test('ray/cylinder hits the side and respects the vertical span', () => {
  const origin = { x: 0, y: 1, z: 0 };
  const result = rayCylinder(origin, FORWARD, { x: 0, z: -5, radius: 0.5, minY: 0, maxY: 2 });
  assert.ok(Math.abs(result - 4.5) < 1e-6, `expected 4.5, got ${result}`);

  // Above the cylinder's head: no hit.
  assert.equal(
    rayCylinder({ x: 0, y: 3, z: 0 }, FORWARD, { x: 0, z: -5, radius: 0.5, minY: 0, maxY: 2 }),
    -1,
  );
  // Away from it: no hit.
  assert.equal(rayCylinder(origin, { x: 0, y: 0, z: 1 }, { x: 0, z: -5, radius: 0.5, minY: 0, maxY: 2 }), -1);
});

test('ray/box intersection works for the box faces used as cover', () => {
  const box = { min: { x: -1, y: 0, z: -6 }, max: { x: 1, y: 3, z: -4 } };
  const hit = rayBox({ x: 0, y: 1, z: 0 }, FORWARD, box);
  assert.ok(Math.abs(hit - 4) < 1e-6, `expected 4, got ${hit}`);
  assert.equal(rayBox({ x: 5, y: 1, z: 0 }, FORWARD, box), -1);
  assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box), -1, 'pointing away');
});

test('rayWorld finds the ground surface and misses into the sky', () => {
  const collider = new Collider({ heightSampler: { heightAt: () => 0 } });

  const down = { x: 0, y: -1, z: 0 };
  const hit = rayWorld({ x: 3, y: 5, z: 4 }, down, 20, collider);
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.distance - 5) < 0.15, `expected ~5m to the ground, got ${hit.distance}`);
  assert.ok(Math.abs(hit.point.y) < 0.15);

  const up = rayWorld({ x: 0, y: 2, z: 0 }, UP, 50, collider);
  assert.equal(up.hit, false);
  assert.equal(up.distance, 50);

  const inside = rayWorld({ x: 0, y: -1, z: 0 }, down, 20, collider);
  assert.equal(inside.hit, true);
  assert.equal(inside.distance, 0, 'starting inside geometry is an immediate hit');

  assert.equal(rayWorld({ x: 0, y: 1, z: 0 }, FORWARD, 10, null).hit, false);
});

test('rayWorld stops at a wall and reports the surface normal', () => {
  const heightSampler = { heightAt: () => 0 };
  const wall = new BoxBlocker({
    center: { x: 0, y: 1.5, z: -6 },
    size: { x: 8, y: 3, z: 0.6 },
  });
  const collider = new Collider({ heightSampler, boxes: [wall] });

  const hit = rayWorld({ x: 0, y: 1.2, z: 0 }, FORWARD, 30, collider);
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.distance - 5.4) < 0.35, `expected ~5.4m to the wall, got ${hit.distance.toFixed(2)}`);

  const normal = surfaceNormal(hit.point, collider);
  assert.ok(normal.z > 0.7, `wall normal should face the shooter, got z=${normal.z.toFixed(2)}`);

  const groundNormal = surfaceNormal({ x: 4, y: 0, z: 4 }, collider);
  assert.ok(groundNormal.y > 0.7, `ground normal should point up, got y=${groundNormal.y.toFixed(2)}`);
});

test('rayActors returns the nearest live actor and skips ignored/dead ones', () => {
  const near = dummy({ id: 'near', position: { x: 0, y: 0, z: -6 } });
  const far = dummy({ id: 'far', position: { x: 0, y: 0, z: -14 } });
  const origin = { x: 0, y: 1, z: 0 };

  const hit = rayActors(origin, FORWARD, [far, near]);
  assert.equal(hit.actor.id, 'near');
  assert.ok(hit.distance < 6);

  const ignoring = rayActors(origin, FORWARD, [near, far], { ignoreId: 'near' });
  assert.equal(ignoring.actor.id, 'far');

  near.health.dead = true;
  assert.equal(rayActors(origin, FORWARD, [near, far]).actor.id, 'far', 'dead actors are ignored');

  const disabled = rayActors(origin, FORWARD, [near], { ignoreId: 'far' });
  assert.equal(disabled.actor, null, 'nothing left to hit');

  const outOfRange = rayActors(origin, FORWARD, [far], { maxDistance: 5 });
  assert.equal(outOfRange.actor, null, 'beyond max distance');
});

test('traceShot prefers the nearest of actor and world (cover works)', () => {
  const heightSampler = { heightAt: () => 0 };
  const wall = new BoxBlocker({ center: { x: 0, y: 1.5, z: -6 }, size: { x: 6, y: 3, z: 0.5 } });
  const collider = new Collider({ heightSampler, boxes: [wall] });
  const behindCover = dummy({ id: 'covered', position: { x: 0, y: 0, z: -12 } });
  const inTheOpen = dummy({ id: 'open', position: { x: 0, y: 0, z: -4 } });

  const origin = { x: 0, y: 1.2, z: 0 };

  const blocked = traceShot(origin, FORWARD, { collider, actors: [behindCover], ignoreId: 'player' });
  assert.equal(blocked.surface, 'world', 'the wall stops the shot');
  assert.equal(blocked.actor, null);
  assert.ok(blocked.normal);

  const clear = traceShot(origin, FORWARD, { collider, actors: [behindCover, inTheOpen], ignoreId: 'player' });
  assert.equal(clear.surface, 'actor');
  assert.equal(clear.actor.id, 'open');

  const miss = traceShot(origin, UP, { collider, actors: [inTheOpen], maxDistance: 40 });
  assert.equal(miss.hit, false);
  assert.equal(miss.actor, null);
  assert.equal(miss.surface, null);
});

test('traceShot can shoot the shooter out of the equation', () => {
  const shooter = dummy({ id: 'player', position: { x: 0, y: 0, z: -1 } });
  const target = dummy({ id: 'target', position: { x: 0, y: 0, z: -8 } });
  const hit = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, {
    collider: null,
    actors: [shooter, target],
    ignoreId: 'player',
  });
  assert.equal(hit.actor.id, 'target');
});

test('spread keeps shots inside the cone and is deterministic per seed', () => {
  const random = new Random('spread-seed');
  const spread = 0.05;

  let maxAngle = 0;
  for (let i = 0; i < 300; i += 1) {
    const dir = applySpread(FORWARD, spread, random);
    const length = Math.hypot(dir.x, dir.y, dir.z);
    assert.ok(Math.abs(length - 1) < 1e-6, 'spread always returns a unit vector');
    const angle = Math.acos(Math.max(-1, Math.min(1, -dir.z)));
    maxAngle = Math.max(maxAngle, angle);
    assert.ok(angle <= spread + 1e-6, `shot left the cone: ${angle}`);
  }
  assert.ok(maxAngle > spread * 0.2, 'the cone is actually used');

  const a = applySpread(FORWARD, spread, new Random('same'));
  const b = applySpread(FORWARD, spread, new Random('same'));
  assert.deepEqual(a, b, 'same seed, same shot');

  const noSpread = applySpread(FORWARD, 0, random);
  assert.deepEqual(noSpread, FORWARD, 'zero spread is an exact copy');
});

test('pointAt walks along a ray', () => {
  assert.deepEqual(pointAt({ x: 1, y: 2, z: 3 }, FORWARD, 4), { x: 1, y: 2, z: -1 });
});

// ===========================================================================
// Weapon
// ===========================================================================

test('a new weapon starts loaded with a full magazine and reserve', () => {
  const weapon = createWeapon('rifle');
  assert.equal(weapon.magazine, WEAPONS.rifle.magazineSize);
  assert.equal(weapon.reserve, WEAPONS.rifle.reserveAmmo);
  assert.equal(weapon.isReloading, false);
  assert.equal(weapon.canFire(), true);
  assert.equal(weapon.ammo.magazineSize, WEAPONS.rifle.magazineSize);
});

test('firing consumes ammo and is rate limited by the cooldown', () => {
  const weapon = createWeapon('rifle');
  const shots = [];
  weapon.on('fired', ({ magazine }) => shots.push(magazine));

  const step = 1 / 60;
  const first = weapon.tryFire();
  assert.equal(first.fired, true);
  assert.equal(weapon.magazine, WEAPONS.rifle.magazineSize - 1);

  assert.equal(weapon.tryFire().fired, false, 'cannot fire twice in one instant');
  assert.equal(weapon.tryFire().reason, 'cooldown');

  // Hold the trigger for one second.
  let fired = 1;
  for (let t = 0; t < 1; t += step) {
    weapon.update(step);
    if (weapon.tryFire().fired) fired += 1;
  }

  const expected = WEAPONS.rifle.fireRate;
  assert.ok(
    Math.abs(fired - expected) <= 1,
    `expected ~${expected} shots in a second, got ${fired}`,
  );
  assert.equal(shots.length, fired);
  assert.equal(weapon.magazine, WEAPONS.rifle.magazineSize - fired);
});

test('an empty magazine refuses to fire and reports dry', () => {
  const weapon = createWeapon('rifle', { magazineSize: 2, reserveAmmo: 4 });
  const events = [];
  weapon.on('dry', () => events.push('dry'));

  assert.equal(weapon.tryFire().fired, true);
  weapon.update(1);
  assert.equal(weapon.tryFire().fired, true);
  weapon.update(1);

  const empty = weapon.tryFire();
  assert.equal(empty.fired, false);
  assert.equal(empty.reason, 'empty');
  assert.equal(weapon.isMagazineEmpty, true);
  assert.deepEqual(events, ['dry']);
});

test('reloading moves rounds from reserve into the magazine over time', () => {
  const weapon = createWeapon('rifle');
  weapon.magazine = 4;
  const events = [];
  weapon.on('reload:start', () => events.push('start'));
  weapon.on('reload:end', ({ transfer }) => events.push(`end:${transfer}`));

  const started = weapon.startReload();
  assert.equal(started.started, true);
  assert.equal(weapon.isReloading, true);
  assert.equal(weapon.canFire(), false, 'cannot fire mid-reload');

  weapon.update(WEAPONS.rifle.reloadTime * 0.5);
  assert.equal(weapon.isReloading, true, 'still reloading halfway through');
  assert.ok(weapon.reloadProgress > 0.3 && weapon.reloadProgress < 0.7);

  weapon.update(WEAPONS.rifle.reloadTime * 0.5 + 0.01);
  assert.equal(weapon.isReloading, false);
  assert.equal(weapon.magazine, WEAPONS.rifle.magazineSize);
  assert.equal(weapon.reserve, WEAPONS.rifle.reserveAmmo - (WEAPONS.rifle.magazineSize - 4));
  assert.deepEqual(events, ['start', 'end:26']);
});

test('reloading is capped by the reserve and refused when pointless', () => {
  const weapon = createWeapon('rifle', { reserveAmmo: 3 });
  weapon.magazine = 0;
  weapon.startReload();
  weapon.update(WEAPONS.rifle.reloadTime + 0.01);
  assert.equal(weapon.magazine, 3, 'only the available rounds are loaded');
  assert.equal(weapon.reserve, 0);

  assert.deepEqual(weapon.startReload(), { started: false, reason: 'no-ammo' });
  weapon.magazine = WEAPONS.rifle.magazineSize;
  assert.deepEqual(weapon.startReload(), { started: false, reason: 'full' });
});

test('a reload can be cancelled and refilling restores everything', () => {
  const weapon = createWeapon('rifle');
  weapon.magazine = 10;
  weapon.startReload();
  assert.equal(weapon.cancelReload(), true);
  assert.equal(weapon.isReloading, false);
  assert.equal(weapon.magazine, 10, 'cancelling does not transfer ammo');
  assert.equal(weapon.cancelReload(), false, 'nothing to cancel');

  weapon.refill();
  assert.equal(weapon.magazine, WEAPONS.rifle.magazineSize);
  assert.equal(weapon.reserve, WEAPONS.rifle.reserveAmmo);
});

test('spread depends on movement, aiming and sustained fire', () => {
  const weapon = createWeapon('rifle');
  const spread = WEAPONS.rifle.spread;

  const standing = weapon.spreadAt({});
  assert.equal(standing, spread.standing);

  const moving = weapon.spreadAt({ moving: true });
  assert.ok(moving > standing, 'moving is less accurate');

  const aiming = weapon.spreadAt({ aiming: true });
  assert.ok(aiming < standing, 'aiming is more accurate');

  // Bloom grows with each shot...
  weapon.tryFire();
  assert.ok(weapon.bloom >= spread.perShot - 1e-9);
  weapon.cooldown = 0;
  weapon.tryFire();
  assert.ok(weapon.bloom >= spread.perShot * 2 - 1e-9);
  assert.equal(weapon.spreadAt({}), standing + weapon.bloom);

  // ...is capped...
  for (let i = 0; i < 40; i += 1) weapon.bloom += spread.perShot;
  assert.equal(weapon.spreadAt({}), spread.max);

  // ...and recovers over time.
  weapon.bloom = spread.max;
  weapon.update(1);
  assert.ok(weapon.spreadAt({}) < spread.max, 'bloom recovers when not firing');
});

test('headshots are multiplied from the weapon definition', () => {
  const weapon = createWeapon('rifle');
  assert.equal(weapon.type.headshotMultiplier, 2);
  assert.equal(weapon.damageAt(10) * weapon.type.headshotMultiplier, 48);
});

test('damage falls off with distance and never goes below the minimum', () => {
  const weapon = createWeapon('rifle');
  const full = weapon.damageAt(10);
  assert.equal(full, WEAPONS.rifle.damage);

  const mid = weapon.damageAt((COMBAT.falloffStart + COMBAT.falloffEnd) / 2);
  assert.ok(mid < full && mid > full * COMBAT.minFalloffScale * 0.9);

  const far = weapon.damageAt(10_000);
  assert.ok(Math.abs(far - full * COMBAT.minFalloffScale) < 1e-6, 'clamped at the minimum scale');
  assert.ok(weapon.damageAt(200) < weapon.damageAt(120), 'monotonically decreasing');
});

test('weapon types are data driven and new weapons can be registered', () => {
  assert.ok(listWeaponIds().includes('rifle'));
  assert.equal(getWeaponType('rifle').kind, 'hitscan');
  assert.throws(() => getWeaponType('nope'), /Unknown weapon/);
  assert.throws(() => createWeaponModel('nope'), /Unknown weapon model/);

  // Extensibility: a new weapon is a definition, not a code path.
  registerWeaponType({
    id: 'test-pistol',
    name: 'Test Pistol',
    kind: 'hitscan',
    automatic: false,
    damage: 12,
    fireRate: 3,
    magazineSize: 8,
    reserveAmmo: 40,
    reloadTime: 1.2,
    range: 60,
    muzzle: { x: 0, y: 1.2, z: -0.4 },
    model: 'rifle',
  });

  const pistol = createWeapon('test-pistol');
  assert.equal(pistol.name, 'Test Pistol');
  assert.equal(pistol.type.automatic, false);
  assert.equal(pistol.tryFire().fired, true);
  assert.equal(pistol.damageAt(1), 12);
  assert.ok(listWeaponIds().includes('test-pistol'));
});

test('weapon models expose a muzzle node for effects and shot origins', () => {
  const model = createWeaponModel('rifle');
  assert.equal(model.userData.modelId, 'rifle');
  assert.ok(model.userData.muzzle, 'the muzzle node is published on userData');
  assert.equal(model.userData.muzzle.name, 'muzzle');
  assert.ok(model.getObjectByName('muzzle'), 'and is in the scene graph');
  assert.ok(model.children.length > 3, 'the model has parts');
  assert.ok(model.userData.materials.length > 0, 'materials are tracked for disposal');
});

test('a weapon from a definition can be a projectile kind later without code changes', () => {
  // Weapons only expose `kind`; systems read it from data. This guards the
  // contract that future weapon kinds stay data driven.
  const rifle = getWeaponType('rifle');
  assert.ok(['hitscan', 'projectile'].includes(rifle.kind));
});

// ===========================================================================
// Training dummies
// ===========================================================================

test('a dummy takes damage, dies and rebuilds itself', () => {
  const target = new TrainingDummy({ id: 'target-0', x: 4, z: 4, groundY: 0, config: { maxHealth: 50, radius: 0.45, height: 1.75 }, respawnDelay: 1 });
  assert.equal(target.alive, true);
  assert.equal(target.health.current, 50);

  const hit = target.damageable.takeDamage(20, { weapon: 'rifle' });
  assert.equal(hit.applied, 20);
  assert.equal(target.health.current, 30);

  target.update(0.1, {});
  assert.ok(target.hitFlash > 0, 'hits flash the dummy');

  const fatal = target.damageable.takeDamage(100, { weapon: 'rifle' });
  assert.equal(fatal.killed, true);
  assert.equal(target.alive, false);

  // The owner reacts to the death event, exactly like TargetSystem does.
  target.onDestroyed();
  assert.equal(target.damageable.enabled, false, 'a fallen dummy cannot be shot');

  target.update(0.5, {});
  assert.ok(target.group.rotation.x < 0, 'it tips over');

  target.update(0.6, {});
  assert.equal(target.alive, true, 'it stands back up after the delay');
  assert.equal(target.health.current, 50);
  assert.equal(target.damageable.enabled, true);
});

test('dummies can be solid obstacles for the player', () => {
  const target = new TrainingDummy({ id: 'target-0', x: 10, z: 0, groundY: 0, config: { maxHealth: 100, radius: 0.45, height: 1.75 } });
  const collider = new Collider({ heightSampler: { heightAt: () => 0 } });
  const body = { radius: 0.36, height: 1.8, stepHeight: 0.5 };

  assert.equal(collider.isClear(10, 0, 0, body), true);
  target.setSolid(collider, true);
  assert.equal(collider.cylinders.length, 1);
  assert.equal(collider.isClear(10, 0, 0, body), false, 'the dummy blocks the spot');

  target.setSolid(collider, false);
  assert.equal(collider.cylinders.length, 0);
  assert.equal(collider.isClear(10, 0, 0, body), true);
});

test('dummies face the shooter and billboard their health bar', () => {
  const target = new TrainingDummy({ id: 'target-0', x: 10, z: 0, groundY: 0, config: { maxHealth: 100, radius: 0.45, height: 1.75 } });
  const quaternion = { x: 0, y: 0, z: 0, w: 1 };
  target.update(1, { lookAt: { x: 0, y: 0, z: 0 }, cameraQuaternion: quaternion });
  assert.ok(Math.abs(target.group.rotation.y) > 0.5, 'turned towards the origin');

  target.damageable.takeDamage(50);
  target.update(0.1, { cameraQuaternion: quaternion });
  assert.ok(Math.abs(target.healthFill.scale.x - 0.5) < 1e-6, 'the bar drains in step with health');
});

// ===========================================================================
// Weapon view
// ===========================================================================

test('the weapon view blends hip and aim poses', async () => {
  const { WeaponView } = await import('../src/combat/weapons/WeaponView.js');
  const { Object3D } = await import('three');
  const weapon = createWeapon('rifle');
  const hand = new Object3D();
  const view = new WeaponView(weapon, { attachTo: hand });

  assert.equal(hand.children.includes(view.root), true, 'mounted on the hand');
  const hip = view.pivot.position.clone();

  for (let i = 0; i < 120; i += 1) view.update(1 / 60, { aiming: true });
  const aimed = view.pivot.position.clone();
  assert.ok(view.aim > 0.95, 'reached the aim pose');
  assert.ok(aimed.distanceTo(hip) > 0.05, 'the two poses differ');

  for (let i = 0; i < 120; i += 1) view.update(1 / 60, { aiming: false });
  assert.ok(view.aim < 0.05, 'returned to the hip pose');

  view.setRecoil(1);
  view.update(1 / 60, {});
  assert.ok(view.pivot.position.z > hip.z, 'recoil pushes the weapon back');
  for (let i = 0; i < 60; i += 1) view.update(1 / 60, {});
  assert.ok(view.recoil < 0.05, 'recoil settles');

  const muzzle = view.getWorldMuzzle();
  assert.ok(Number.isFinite(muzzle.x) && Number.isFinite(muzzle.y) && Number.isFinite(muzzle.z));
  view.dispose();
});

// ===========================================================================
// Combat effects
// ===========================================================================

test('combat effects pool tracers and fade them out', async () => {
  const { CombatEffects } = await import('../src/combat/CombatEffects.js');
  const { Object3D } = await import('three');
  const effects = new CombatEffects();
  const group = new Object3D();
  effects.group = group;
  effects._buildTracers(2);
  effects._buildImpacts(2);

  const hud = new Object3D();
  effects.attachMuzzleFlash(hud);

  effects.spawnTracer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 });
  assert.equal(effects.activeTracerCount, 1);
  const line = effects.group.children[0];
  assert.equal(line.visible, true);
  assert.equal(line.geometry.attributes.position.getZ(1), -10);

  effects.spawnMuzzleFlash();
  assert.equal(hud.children[0].visible, true);

  effects.spawnImpact({ x: 0, y: 0, z: -10 }, { x: 0, y: 1, z: 0 });
  const points = effects.group.getObjectByName('impacts');
  assert.ok(points, 'impact points exist');

  effects.update(1);
  assert.equal(effects.activeTracerCount, 0, 'tracers expire');
  assert.equal(line.visible, false);
  assert.equal(hud.children[0].visible, false, 'the muzzle flash expires');

  // Pooling: more tracers than slots reuses them without growing the pool.
  for (let i = 0; i < 10; i += 1) effects.spawnTracer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -1 });
  assert.equal(effects.group.children.filter((c) => c.type === 'Line').length, 2);

  effects.clear();
  assert.equal(effects.activeTracerCount, 0);
});
