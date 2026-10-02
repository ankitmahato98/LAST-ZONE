import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, installPointerLock, pointer, key, advance } from './helpers/dom.js';
import { headlessRendererFactory } from './helpers/headlessRenderer.js';
import { registerWeaponType } from '../src/combat/weapons/WeaponTypes.js';
import * as rngModule from '../src/utils/rng.js';

/**
 * Combat, end to end, through the *real* game wiring.
 *
 * Everything here goes through the same entry points a player uses: keyboard and
 * mouse events on the canvas, pointer events on the touch pad, the menu buttons,
 * and the shared input intent. Nothing calls a private combat method to make a
 * shot happen.
 */
const harness = installDom();

let game;
let window;
let document;
let services;
let combat;
let targets;
let player;
let camera;
let hud;

const S = (name) => services.get(name);

/** Aim the camera at a world point, with the orbit camera settled first. */
function aimAt(point) {
  camera.snapToPlayer();
  for (let i = 0; i < 2; i += 1) {
    camera.lookAtPoint(point);
    advance(game, 1 / 60);
  }
  camera.lookAtPoint(point);
}

/** Place the player `distance` metres in front of a dummy and aim at its chest. */
function standOffFrom(dummy, distance = 12) {
  const { x, z } = dummy.position;
  const angle = Math.atan2(x, z); // outward from the arena centre
  const px = x - Math.sin(angle) * distance;
  const pz = z - Math.cos(angle) * distance;
  player.teleport(px, pz);
  advance(game, 0.25);
  aimAt({ x: dummy.position.x, y: dummy.position.y + 1.3, z: dummy.position.z });
  return dummy;
}

function holdFire(seconds) {
  S('input').press('test:fire', 'primary');
  advance(game, seconds);
  S('input').release('test:fire', 'primary');
}

test('combat boots with a weapon, health and a dummy range', async (t) => {
  const { createGame } = await import('../src/core/engine.js');
  window = globalThis.window;
  document = globalThis.document;
  installPointerLock(window);

  const { game: instance } = await createGame({
    canvas: document.getElementById('game-canvas'),
    uiRoot: document.getElementById('ui-root'),
    rendererFactory: headlessRendererFactory,
  });
  game = instance;
  game.start();
  game.loop.stop();
  services = game.services;

  combat = S('combat');
  targets = S('targets');
  player = S('player');
  camera = S('camera3p');
  hud = S('combatHud');

  await t.test('the combat services are wired and the player is armed', () => {
    assert.ok(combat, 'combat service');
    assert.ok(targets, 'target system');
    assert.ok(S('combatEffects'), 'effects');
    assert.ok(hud, 'combat HUD');

    assert.equal(combat.weapon.type.id, 'rifle');
    assert.equal(combat.ammo.magazine, combat.weapon.type.magazineSize);
    assert.equal(combat.health, combat.maxHealth);
    assert.equal(combat.isEliminated, false);
    assert.equal(combat.isProtected, true, 'spawn protection is active at boot');

    // The weapon model is attached to the character's right hand.
    const view = S('characterView');
    const mount = view.arms.right.joint.getObjectByName('weapon-mount');
    assert.ok(mount, 'weapon is mounted on the hand');
    assert.ok(mount.getObjectByName('muzzle'), 'and exposes a muzzle');

    // The muzzle sits in front of the character, near chest height.
    const muzzle = combat.weaponView.getWorldMuzzle();
    const toPlayer = Math.hypot(muzzle.x - player.position.x, muzzle.z - player.position.z);
    assert.ok(toPlayer > 0.1 && toPlayer < 1.2, `muzzle ${toPlayer.toFixed(2)}m from the player`);
    assert.ok(muzzle.y > player.position.y + 0.8, 'held at chest height');
  });

  await t.test('the dummy range is placed on walkable ground', () => {
    assert.equal(targets.dummies.length, 8);
    const world = S('world');
    for (const dummy of targets.dummies) {
      const y = world.heightAt(dummy.position.x, dummy.position.z);
      assert.ok(Math.abs(dummy.position.y - y) < 1e-6, `${dummy.id} stands on the ground`);
      assert.equal(dummy.health.max, 100);
    }

    // They are spread out and reachable from the spawn pad.
    for (let i = 0; i < targets.dummies.length; i += 1) {
      for (let j = i + 1; j < targets.dummies.length; j += 1) {
        const a = targets.dummies[i].position;
        const b = targets.dummies[j].position;
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2, 'dummies do not overlap');
      }
    }

    // Dummies are solid: the player collider knows about them.
    assert.ok(
      S('world').collider.cylinders.some((c) => c.name.startsWith('target-')),
      'dummies are registered as obstacles',
    );
    assert.equal(targets.aliveCount, 8);
  });

  await t.test('the combat HUD shows the reticle, health and ammo', () => {
    assert.ok(document.querySelector('.reticle'), 'dynamic reticle exists');
    assert.equal(document.querySelector('.hud__crosshair').style.display, 'none', 'the static crosshair is hidden');

    hud.update(1 / 60);
    assert.equal(document.querySelector('.vitals__value').textContent, '100');
    assert.equal(document.querySelector('.ammo__mag').textContent, '30');
    assert.equal(document.querySelector('.ammo__reserve').textContent, '/ 210');
    assert.equal(document.querySelector('.ammo__kills').textContent, 'KILLS 0');
  });

  await t.test('the menu opens over combat and Deploy starts the match', () => {
    assert.equal(game.status, 'paused');
    document.querySelector('#ui-root .button').click();
    assert.equal(game.status, 'running');
    advance(game, 0.1);
  });

  await t.test('mouse fire hits a training dummy, with tracer and hit marker', () => {
    const dummy = standOffFrom(targets.dummies[0]);
    const hits = [];
    const shots = [];
    const off = [
      game.bus.on('combat:hit', (payload) => hits.push(payload)),
      game.bus.on('weapon:fired', (payload) => shots.push(payload)),
    ];

    // Watch the effect spawns: tracers only live ~55ms, so sampling after the
    // burst would always come up empty.
    const effects = S('combatEffects');
    const tracers = [];
    const flashes = [];
    const originalTracer = effects.spawnTracer.bind(effects);
    const originalFlash = effects.spawnMuzzleFlash.bind(effects);
    effects.spawnTracer = (from, to, options) => {
      tracers.push({ from, to, options });
      return originalTracer(from, to, options);
    };
    effects.spawnMuzzleFlash = (options) => {
      flashes.push(options);
      return originalFlash(options);
    };

    // Real mouse path: click the canvas (captures the pointer) and hold.
    const canvas = document.getElementById('game-canvas');
    pointer(canvas, 'pointerdown', { clientX: 640, clientY: 360, button: 0, pointerType: 'mouse' });
    advance(game, 0.35);
    assert.equal(S('pointerLook').isLocked, true, 'the click captured the pointer');

    pointer(window, 'pointerup', { clientX: 640, clientY: 360, button: 0, pointerType: 'mouse' });
    fromTheBus(off);
    effects.spawnTracer = originalTracer;
    effects.spawnMuzzleFlash = originalFlash;

    assert.ok(shots.length >= 2, `expected a burst, got ${shots.length} shots`);
    assert.ok(hits.length >= 2, `expected hits, got ${hits.length}`);
    assert.ok(hits.every((h) => h.actor === dummy.id), 'all shots landed on the aimed dummy');

    const first = hits[0];
    assert.ok(first.damage > 0);
    assert.ok(Math.abs(first.damage - combat.weapon.type.damage) < 6, 'close range is near full damage');
    assert.ok(first.distance > 5 && first.distance < 20);
    assert.equal(first.killed, false);

    assert.ok(dummy.health.current < 100, `dummy took damage (${dummy.health.current})`);
    assert.ok(combat.stats.hits === hits.length);
    assert.equal(combat.ammo.magazine, 30 - shots.length, 'each shot consumed a round');

    // Feedback: one muzzle flash and one tracer per shot, drawn from the muzzle
    // to the point of impact.
    assert.equal(flashes.length, shots.length, 'every shot flashed the muzzle');
    assert.equal(tracers.length, shots.length, 'every shot drew a tracer');

    const muzzle = combat.weaponView.getWorldMuzzle();
    const tracer = tracers[0];
    assert.ok(
      Math.hypot(tracer.from.x - muzzle.x, tracer.from.y - muzzle.y, tracer.from.z - muzzle.z) < 1.5,
      'the tracer starts at the muzzle',
    );
    assert.ok(
      Math.hypot(tracer.to.x - dummy.position.x, tracer.to.z - dummy.position.z) < 1.5,
      'and ends at the dummy',
    );
    const marker = document.querySelector('.reticle__hitmarker');
    assert.ok(Number(marker.style.opacity) > 0, 'hit marker is visible after a hit');
    assert.equal(marker.classList.contains('reticle__hitmarker--kill'), false, 'not a kill marker');
    assert.ok(S('combatEffects').group.getObjectByName('impacts'), 'impact pool exists');

    // ...and it fades away again when nothing is hit.
    advance(game, 1);
    hud.update(1 / 60);
    assert.equal(Number(marker.style.opacity) || 0, 0, 'hit marker fades out');
  });

  await t.test('bullets are stopped by cover', () => {
    const tower = { x: 0, y: 2.5, z: -15 }; // arena tower: solid, 6m tall
    const impacts = [];
    const hits = [];
    const off = [
      game.bus.on('combat:impact', (payload) => impacts.push(payload)),
      game.bus.on('combat:hit', (payload) => hits.push(payload)),
    ];

    // Stand 10m from the tower and put the wall between us and the far side.
    player.teleport(0, -5);
    advance(game, 0.25);
    aimAt(tower);
    holdFire(0.3);
    fromTheBus(off);

    assert.ok(impacts.length >= 2, `expected wall impacts, got ${impacts.length}`);
    assert.equal(hits.length, 0, 'nothing behind the wall was hit');
    assert.ok(impacts[0].normal, 'impacts carry a surface normal');
    assert.ok(impacts[0].normal.z > 0.5, 'the normal faces the shooter');
  });

  await t.test('a dummy dies, drops, respawns, and the HUD counts the kill', () => {
    const dummy = standOffFrom(targets.dummies[1]);
    const kills = [];
    const off = [game.bus.on('combat:kill', (payload) => kills.push(payload))];

    holdFire(2.5);
    fromTheBus(off);

    assert.equal(dummy.alive, false, `dummy should be destroyed (hp ${dummy.health.current})`);
    assert.equal(kills.length, 1);
    assert.equal(kills[0].actor, dummy.id);
    assert.equal(combat.stats.kills >= 1, true);
    assert.equal(dummy.damageable.enabled, false, 'a fallen dummy cannot be shot again');
    assert.ok(
      !S('world').collider.cylinders.includes(dummy.blocker),
      'a fallen dummy stops blocking movement',
    );

    advance(game, 0.5);
    assert.ok(dummy.group.rotation.x < -0.4, 'it tips over');

    // The HUD reflects the kill.
    combatHudRefresh();
    assert.equal(document.querySelector('.ammo__kills').textContent, `KILLS ${combat.stats.kills}`);

    // Rebuild timer.
    advance(game, 5);
    assert.equal(dummy.alive, true, 'the dummy stands back up');
    assert.equal(dummy.health.current, 100);
    assert.ok(S('world').collider.cylinders.includes(dummy.blocker), 'and blocks movement again');
  });

  await t.test('reloading refills the magazine from reserve on demand (R key)', () => {
    key(window, 'keydown', 'KeyR');
    key(window, 'keyup', 'KeyR');
    advance(game, 1 / 60);

    assert.equal(combat.isReloading, true, 'R starts a reload');
    assert.equal(combat.weapon.canFire(), false, 'cannot fire while reloading');
    assert.equal(document.querySelector('.ammo__reload').classList.contains('ammo__reload--active'), true);

    const before = { magazine: combat.ammo.magazine, reserve: combat.ammo.reserve };
    advance(game, combat.weapon.type.reloadTime * 0.5);
    assert.ok(combat.ammo.reloadProgress > 0.3 && combat.ammo.reloadProgress < 0.8);

    // Firing is blocked mid-reload.
    const shots = combat.stats.shots;
    holdFire(0.2);
    assert.equal(combat.stats.shots, shots, 'no shots while reloading');

    advance(game, combat.weapon.type.reloadTime * 0.6);
    assert.equal(combat.isReloading, false);
    assert.equal(combat.ammo.magazine, combat.weapon.type.magazineSize);
    assert.ok(combat.ammo.reserve < before.reserve, 'rounds came out of the reserve');
    assert.equal(document.querySelector('.ammo__reload').classList.contains('ammo__reload--active'), false);
  });

  await t.test('firing on an empty magazine auto-reloads', () => {
    combat.weapon.magazine = 1;
    const shots = combat.stats.shots;
    holdFire(0.5);
    assert.equal(combat.stats.shots, shots + 1, 'exactly the last round left the barrel');
    assert.equal(combat.isReloading, true, 'and the weapon reloaded itself');
    advance(game, combat.weapon.type.reloadTime + 0.1);
    assert.equal(combat.ammo.magazine, combat.weapon.type.magazineSize);
  });

  await t.test('the fire rate is respected over a full second', () => {
    combat.weapon.magazine = combat.weapon.type.magazineSize;
    const before = combat.stats.shots;
    holdFire(1);
    const fired = combat.stats.shots - before;
    const expected = combat.weapon.type.fireRate;
    assert.ok(
      Math.abs(fired - expected) <= 2,
      `expected ~${expected} rounds in a second, got ${fired}`,
    );
  });

  await t.test('aiming tightens the spread, pulls the camera in and slows the player', () => {
    const hipSpread = combat.spread;
    const hipDistance = camera.currentDistance;
    const hipFov = camera.camera.fov;

    key(window, 'keydown', 'KeyQ'); // aim
    advance(game, 0.5);

    assert.equal(combat.aiming, true);
    assert.ok(combat.aimBlend > 0.9, `aim blend ${combat.aimBlend}`);
    assert.ok(combat.spread < hipSpread, `spread ${combat.spread} < ${hipSpread}`);
    assert.ok(camera.currentDistance < hipDistance, 'camera moves closer over the shoulder');
    assert.ok(camera.camera.fov < hipFov, 'aim zooms the field of view');
    assert.equal(player.controller.speedScale, 0.45, 'aiming slows movement');
    assert.equal(player.controller.aimMode, true, 'the character strafes while aiming');

    key(window, 'keyup', 'KeyQ');
    advance(game, 0.6);
    assert.ok(combat.aimBlend < 0.1, 'released back to hip');
    assert.equal(player.controller.speedScale, 1);
    assert.equal(player.controller.aimMode, false);
  });

  await t.test('recoil kicks the camera and settles back', () => {
    standOffFrom(targets.dummies[2]);
    camera.resetRecoil();
    holdFire(0.15);
    const kicked = Math.abs(camera.recoil.pitch) + Math.abs(camera.recoil.yaw);
    assert.ok(kicked > 0, 'the camera was kicked by the shots');

    advance(game, 1.5);
    assert.ok(Math.abs(camera.recoil.pitch) < 0.002, 'recoil settled');
  });

  await t.test('the touch pad fires, aims and reloads', () => {
    const touch = S('touchControls');
    touch.setVisible(true, { userForced: true });
    standOffFrom(targets.dummies[3]);

    // --- Fire button: hold to shoot --------------------------------------
    const shotsBefore = combat.stats.shots;
    pointer(touch.fireButton, 'pointerdown', { pointerId: 21, pointerType: 'touch' });
    advance(game, 0.3);
    pointer(touch.fireButton, 'pointerup', { pointerId: 21, pointerType: 'touch' });
    advance(game, 1 / 60);
    assert.ok(combat.stats.shots > shotsBefore, 'the touch fire button shot');
    assert.equal(S('input').intent.primaryHeld, false, 'released');

    // --- Aim button: tap to toggle ---------------------------------------
    pointer(touch.aimButton, 'pointerdown', { pointerId: 22, pointerType: 'touch' });
    advance(game, 0.4);
    assert.equal(combat.aiming, true, 'touch aim engaged');
    assert.equal(touch.aiming, true);
    pointer(touch.aimButton, 'pointerdown', { pointerId: 23, pointerType: 'touch' });
    advance(game, 0.4);
    assert.equal(combat.aiming, false, 'touch aim disengaged');

    // --- Reload button ----------------------------------------------------
    combat.weapon.magazine = 5;
    pointer(touch.reloadButton, 'pointerdown', { pointerId: 24, pointerType: 'touch' });
    advance(game, 1 / 60);
    assert.equal(combat.isReloading, true, 'the touch reload button reloaded');
    advance(game, combat.weapon.type.reloadTime + 0.1);
    assert.equal(combat.ammo.magazine, combat.weapon.type.magazineSize);

    touch.setVisible(false);
  });

  await t.test('touch look still steers the aim between shots', () => {
    const touch = S('touchControls');
    touch.setVisible(true, { userForced: true });
    const yawBefore = camera.yaw;

    pointer(touch.lookZone, 'pointerdown', { clientX: 900, clientY: 300, pointerId: 31, pointerType: 'touch' });
    pointer(touch.lookZone, 'pointermove', { clientX: 760, clientY: 300, pointerId: 31, pointerType: 'touch' });
    pointer(touch.lookZone, 'pointerup', { clientX: 760, clientY: 300, pointerId: 31, pointerType: 'touch' });
    advance(game, 0.2);

    assert.ok(Math.abs(camera.yaw - yawBefore) > 0.05, 'touch look rotated the aim');
    touch.setVisible(false);
  });

  await t.test('spawn protection absorbs damage, then health drops and the HUD reacts', () => {
    // Protection is granted on every respawn (and at boot).
    player.respawn();
    advance(game, 1 / 60);
    assert.equal(combat.isProtected, true);

    const absorbed = combat.damagePlayer(30, { source: 'test' });
    assert.equal(absorbed.ignored, true);
    assert.equal(combat.health, 100);

    advance(game, 1.5); // protection expires
    assert.equal(combat.isProtected, false);

    const hurt = [];
    const off = [game.bus.on('combat:player:hurt', (payload) => hurt.push(payload))];
    const applied = combat.damagePlayer(30, { source: 'test' });
    fromTheBus(off);

    assert.equal(applied.applied, 30);
    assert.equal(combat.health, 70);
    assert.equal(hurt.length, 1);
    assert.equal(hurt[0].health, 70);

    combatHudRefresh();
    assert.equal(document.querySelector('.vitals__value').textContent, '70');
    assert.ok(Number(document.querySelector('.damage-vignette').style.opacity) > 0, 'damage vignette flashes');
  });

  await t.test('the debug key hurts the player through the real input path', () => {
    const before = combat.health;
    key(window, 'keydown', 'KeyH');
    key(window, 'keyup', 'KeyH');
    advance(game, 1 / 60);
    assert.equal(combat.health, before - 25);
  });

  await t.test('losing all health eliminates the player and locks control', () => {
    const eliminations = [];
    const off = [game.bus.on('combat:player:eliminated', (payload) => eliminations.push(payload))];

    combat.damagePlayer(1000, { source: 'test' });
    advance(game, 1 / 60);
    fromTheBus(off);

    assert.equal(combat.health, 0);
    assert.equal(combat.isEliminated, true);
    assert.equal(eliminations.length, 1);
    assert.equal(player.controllable, false, 'the pawn stops taking input');

    // Movement and shooting are dead.
    const position = player.position.clone();
    const shots = combat.stats.shots;
    key(window, 'keydown', 'KeyW');
    holdFire(0.3);
    key(window, 'keyup', 'KeyW');
    advance(game, 0.2);
    assert.ok(Math.hypot(position.x - player.position.x, position.z - player.position.z) < 0.4, 'no movement');
    assert.equal(combat.stats.shots, shots, 'no shooting while eliminated');

    // HUD: banner + dimmed reticle.
    combatHudRefresh();
    assert.equal(document.querySelector('.banner').classList.contains('banner--hidden'), false);
    assert.ok(document.querySelector('.banner__sub').textContent.includes('Respawn'));
  });

  await t.test('respawning restores health, ammo and control', () => {
    const restored = [];
    const off = [game.bus.on('combat:player:restored', (payload) => restored.push(payload))];

    player.respawn();
    advance(game, 0.5);
    fromTheBus(off);

    assert.equal(restored.length, 1);
    assert.equal(combat.isEliminated, false);
    assert.equal(combat.health, combat.maxHealth);
    assert.equal(combat.ammo.magazine, combat.weapon.type.magazineSize);
    assert.equal(player.controllable, true);
    assert.equal(combat.isProtected, true, 'respawn grants protection again');
    assert.equal(document.querySelector('.banner').classList.contains('banner--hidden'), true);

    key(window, 'keydown', 'KeyW');
    advance(game, 0.4);
    key(window, 'keyup', 'KeyW');
    assert.ok(player.speed > 2, 'can move again');
  });

  await t.test('fall damage is applied through the landing event', () => {
    advance(game, 1.5); // let protection lapse
    const before = combat.health;
    game.bus.emit('player:land', { speed: 24, position: player.position });
    advance(game, 1 / 60);
    assert.ok(combat.health < before, `fall damage applied (${before} -> ${combat.health})`);

    const gentle = combat.health;
    game.bus.emit('player:land', { speed: 8, position: player.position });
    assert.equal(combat.health, gentle, 'a normal landing does not hurt');
  });

  await t.test('hit markers distinguish body, head and kill hits', () => {
    const marker = document.querySelector('.reticle__hitmarker');
    game.bus.emit('combat:hit', { headshot: false, killed: false });
    assert.equal(marker.classList.contains('reticle__hitmarker--headshot'), false);
    assert.equal(marker.classList.contains('reticle__hitmarker--kill'), false);

    game.bus.emit('combat:hit', { headshot: true, killed: false });
    assert.equal(marker.classList.contains('reticle__hitmarker--headshot'), true);

    game.bus.emit('combat:kill', { headshot: true, killed: true });
    assert.equal(marker.classList.contains('reticle__hitmarker--kill'), true);
  });

  await t.test('the debug overlay reports combat telemetry', () => {
    key(window, 'keydown', 'F3');
    advance(game, 0.5);
    const text = document.querySelector('.hud__debug').innerHTML;
    assert.ok(text.includes('AR-4 Ranger'), 'weapon name');
    assert.ok(text.includes('shots'), 'shot counter');
    assert.ok(text.includes('targets'), 'target counter');
    assert.ok(text.includes('spread'), 'spread readout');
    key(window, 'keydown', 'F3');
  });

  await t.test('a custom weapon can be equipped without touching combat code', () => {
    registerWeaponType({
      id: 'e2e-smg',
      name: 'E2E SMG',
      kind: 'hitscan',
      automatic: true,
      damage: 9,
      headshotMultiplier: 2,
      fireRate: 14,
      magazineSize: 20,
      reserveAmmo: 100,
      reloadTime: 1.2,
      range: 60,
      spread: { standing: 0.02, moving: 0.04, aiming: 0.01, perShot: 0.004, max: 0.06, recovery: 3 },
      recoil: { vertical: 0.006, horizontal: 0.003 },
      muzzle: { x: 0.16, y: 1.2, z: -0.5 },
      model: 'rifle',
    });

    combat.equipWeapon('e2e-smg');
    advance(game, 0.2);

    assert.equal(combat.weapon.name, 'E2E SMG');
    assert.equal(combat.ammo.magazineSize, 20);
    assert.equal(combat.ammo.magazine, 20);
    assert.ok(S('characterView').arms.right.joint.getObjectByName('weapon-mount'), 'still mounted');

    standOffFrom(targets.dummies[4]);
    holdFire(0.4);
    assert.ok(combat.stats.shots > 0, 'the new weapon fires');

    combatHudRefresh();
    assert.equal(document.querySelector('.ammo__mag').textContent, String(combat.ammo.magazine));

    // Put the rifle back for the remaining assertions.
    combat.equipWeapon('rifle');
    advance(game, 0.1);
    assert.equal(combat.weapon.type.id, 'rifle');
  });

  await t.test('headshots do more damage than body shots', () => {
    const dummy = targets.dummies[5];
    const damages = {};

    for (const [label, offset] of [['body', 1.0], ['head', 1.62]]) {
      targets.resetAll();
      advance(game, 0.2);
      const hits = [];
      const off = [game.bus.on('combat:hit', (payload) => hits.push(payload))];

      standOffFrom(dummy);
      aimAt({ x: dummy.position.x, y: dummy.position.y + offset, z: dummy.position.z });
      holdFire(0.2);
      fromTheBus(off);

      assert.ok(hits.length > 0, `${label} shot landed`);
      damages[label] = hits[0].damage;
      assert.equal(hits[0].headshot, label === 'head');
    }

    assert.ok(
      damages.head > damages.body * 1.5,
      `headshots should hurt more (body ${damages.body.toFixed(1)}, head ${damages.head.toFixed(1)})`,
    );
    assert.equal(combat.stats.headshots > 0, true);
  });

  await t.test('the F key fires on desktop as an alternative to the mouse', () => {
    standOffFrom(targets.dummies[6]);
    const shots = combat.stats.shots;
    const hits = combat.stats.hits;
    key(window, 'keydown', 'KeyF');
    advance(game, 0.3);
    key(window, 'keyup', 'KeyF');
    assert.ok(combat.stats.shots > shots, 'F fired');
    assert.ok(combat.stats.hits > hits, 'and the shots landed');
  });

  await t.test('the reticle opens with movement and tightens when aiming', () => {
    const reticle = document.querySelector('.reticle');
    const readGap = () => Number.parseFloat(reticle.style.getPropertyValue('--gap'));
    const readOpacity = () => Number.parseFloat(reticle.style.getPropertyValue('opacity'));

    // Standing still: tight.
    key(window, 'keydown', 'KeyS');
    advance(game, 0.6);
    hud.update(1 / 60);
    const movingGap = readGap();
    key(window, 'keyup', 'KeyS');
    advance(game, 0.6);
    hud.update(1 / 60);
    const standingGap = readGap();
    assert.ok(movingGap > standingGap, `moving reticle (${movingGap}) opens up vs standing (${standingGap})`);

    key(window, 'keydown', 'KeyQ');
    advance(game, 0.5);
    hud.update(1 / 60);
    assert.ok(readGap() < standingGap, 'aiming tightens the reticle further');
    assert.ok(readOpacity() > 0.9, 'the reticle is fully opaque while aiming');
    key(window, 'keyup', 'KeyQ');
    advance(game, 0.4);
  });

  await t.test('a 20 second soak of mixed input never throws', () => {
    const { Random } = require_rng();
    const random = new Random('soak');
    const input = S('input');
    const actions = ['forward', 'backward', 'left', 'right', 'jump', 'sprint', 'primary', 'aim', 'reload'];

    for (let step = 0; step < 1200; step += 1) {
      if (step % 20 === 0) {
        for (const action of actions) {
          if (random.chance(0.35)) input.press('soak', action);
          else input.release('soak', action);
        }
      }
      if (step % 240 === 0) {
        // Keep the player in the fight instead of running off the map.
        const dummy = random.pick(targets.dummies);
        player.teleport(dummy.position.x * 0.6, dummy.position.z * 0.6);
      }
      game.loop.advance(1 / 60);
    }

    for (const action of actions) input.release('soak', action);
    assert.equal(Number.isFinite(player.position.x), true);
    assert.equal(Number.isFinite(combat.health), true);
    assert.ok(combat.ammo.magazine >= 0 && combat.ammo.magazine <= combat.ammo.magazineSize);
    assert.ok(targets.aliveCount >= 0 && targets.aliveCount <= targets.dummies.length);
    // The world is still consistent after all that.
    player.respawn();
    advance(game, 0.5);
    assert.equal(S('world').collider.isClear(player.position.x, player.position.z, player.position.y, player.body), true);
  });

  await t.test('resetAll stands every dummy back up', () => {
    targets.resetAll();
    advance(game, 0.2);
    assert.equal(targets.aliveCount, targets.dummies.length);
  });

  game.dispose();
  harness.dom.window.close();
});

// ---------------------------------------------------------------------------

function fromTheBus(offs) {
  for (const off of offs) off();
}

/** Small helper so the soak test can use the game's own seeded RNG. */
function require_rng() {
  return rngModule;
}

/** The HUD reads live values in its update; run one frame before asserting. */
function combatHudRefresh() {
  hud.update(1 / 60);
}
