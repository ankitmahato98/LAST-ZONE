import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, pointer, key, advance } from './helpers/dom.js';
import { headlessRendererFactory } from './helpers/headlessRenderer.js';

/**
 * End-to-end smoke test.
 *
 * Boots the *real* game - the same `createGame()` wiring the browser uses -
 * under jsdom with a headless renderer, then drives it exactly like a player
 * would: keyboard events, pointer events on the touch pad, and the menu.
 *
 * If this passes, the system graph, the DOM widgets, the input pipeline, the
 * player controller and the camera are all wired together correctly.
 */
const harness = installDom();

let game;
let window;
let document;

test('LAST ZONE boots and runs', async (t) => {
  const { createGame } = await import('../src/core/engine.js');
  const { Collider } = await import('../src/physics/Collider.js');

  window = globalThis.window;
  document = globalThis.document;

  const { game: instance } = await createGame({
    canvas: document.getElementById('game-canvas'),
    uiRoot: document.getElementById('ui-root'),
    rendererFactory: headlessRendererFactory,
  });
  game = instance;

  game.start();
  game.loop.stop(); // the tests drive the simulation deterministically

  const services = () => game.services;
  const player = () => services().get('player');
  const camera = () => services().get('camera3p');

  await t.test('builds the world, the player and the scene graph', () => {
    const renderer = services().get('renderer');
    const world = services().get('world');
    const hud = services().get('hud');

    // The menu opens over the freshly built world, so the simulation is paused
    // until the player presses Deploy (checked in the next subtest).
    assert.equal(game.status, 'paused');
    assert.ok(world.collider instanceof Collider);
    assert.ok(world.stats.boxes > 250, `expected island structure colliders, got ${world.stats.boxes}`);
    assert.ok(world.stats.cylinders > 100, `expected foliage/landmark colliders, got ${world.stats.cylinders}`);
    assert.ok(world.stats.props.trees > 50);
    assert.equal(world.stats.pois, 10);
    assert.ok(world.stats.buildings >= 65);
    assert.equal(world.stats.landmarks, 10);
    assert.ok(world.stats.roads >= 7);
    assert.ok(world.stats.validatedDropCandidates > 0);
    assert.ok(world.futureLootLocations.every((anchor) => anchor.metadataOnly && !anchor.enabled));

    // The scene really contains the island, coastline water, settlements and instanced props.
    assert.ok(renderer.worldGroup.children.length > 0, 'world group is populated');
    const terrain = renderer.worldGroup.getObjectByName('terrain');
    assert.ok(terrain, 'terrain mesh exists');
    assert.ok(terrain.geometry.attributes.position.count > 1000, 'terrain has geometry');
    assert.ok(terrain.geometry.attributes.color, 'terrain is vertex coloured');
    assert.ok(renderer.worldGroup.getObjectByName('surrounding-ocean'), 'coastline meets the visible ocean');
    assert.ok(renderer.worldGroup.getObjectByName('willow-run-river'), 'the carved river is visible');
    assert.ok(renderer.worldGroup.getObjectByName('road-island-spine-west'), 'road network is connected into the scene');
    assert.ok(renderer.actorsGroup.children.length > 0, 'the avatar is in the scene');

    assert.ok(hud.root, 'HUD was mounted');
    assert.ok(document.querySelector('.hud__crosshair'), 'crosshair exists');
    assert.ok(document.querySelector('.hud__location'), 'named POI readout exists');

    const state = player().state;
    assert.ok(Number.isFinite(state.position.y));
    assert.ok(
      Math.abs(state.position.y - world.heightAt(state.position.x, state.position.z)) < 0.01,
      'the player spawns on the ground',
    );
  });

  await t.test('starts paused behind the menu, and Enter Island starts the run', () => {
    const menu = services().get('menu');
    const input = services().get('input');

    assert.equal(menu.isOpen, true, 'the menu is open after boot');
    assert.equal(game.status, 'paused', 'the simulation is paused');
    assert.equal(input.enabled, false, 'input is disabled while paused');

    const spawn = player().state.position.clone();
    advance(game, 1);
    assert.ok(player().state.position.equals(spawn), 'nothing moves while paused');

    document.querySelector('#ui-root .button').click();

    assert.equal(menu.isOpen, false);
    assert.equal(game.status, 'running');
    assert.equal(input.enabled, true);
    assert.ok(document.querySelector('.overlay').classList.contains('overlay--hidden'));
  });

  await t.test('WASD moves the player and the camera follows', () => {
    const position = player().state.position.clone();
    const renderer = services().get('renderer');
    const framesBefore = renderer.frames;

    key(window, 'keydown', 'KeyW');
    advance(game, 1);
    key(window, 'keyup', 'KeyW');
    advance(game, 0.3);

    const state = player().state;
    assert.ok(state.position.z < position.z - 4, `expected to move forward, z=${state.position.z}`);
    assert.ok(renderer.frames > framesBefore, 'the renderer is drawing');
    assert.ok(
      Math.abs(state.position.y - services().get('world').heightAt(state.position.x, state.position.z)) < 0.05,
      'stays on the ground',
    );

    // Camera: behind the player, looking at them.
    const cam = camera();
    const camPos = services().get('renderer').camera.position;
    const distance = Math.hypot(camPos.x - state.position.x, camPos.z - state.position.z);
    assert.ok(distance > 1 && distance < 8, `camera distance ${distance.toFixed(2)}`);
    assert.ok(camPos.y > state.position.y, 'the camera sits above the player');
    assert.ok(cam.currentDistance > 1, 'camera collision kept a sane distance');

    // The avatar mirrors the simulation state.
    const avatar = services().get('characterView').root;
    assert.ok(Math.abs(avatar.position.z - state.position.z) < 1e-6);
  });

  await t.test('sprinting is faster and the player faces the movement direction', () => {
    const pawn = player();
    const position = pawn.state.position.clone();

    // Walk through the open arrival district, then sprint, and compare speeds.
    key(window, 'keydown', 'KeyW');
    advance(game, 0.8);
    const walkSpeed = pawn.state.speed;
    assert.equal(pawn.state.sprinting, false, 'walking by default');

    key(window, 'keydown', 'ShiftLeft');
    advance(game, 0.8);
    const sprintSpeed = pawn.state.speed;
    assert.equal(pawn.state.sprinting, true);
    assert.ok(
      sprintSpeed > walkSpeed + 2.5,
      `sprint speed ${sprintSpeed.toFixed(1)} should beat walk ${walkSpeed.toFixed(1)}`,
    );

    key(window, 'keyup', 'ShiftLeft');
    key(window, 'keyup', 'KeyW');

    // Strafe right: the character turns towards the movement direction.
    key(window, 'keydown', 'KeyD');
    advance(game, 0.8);
    key(window, 'keyup', 'KeyD');

    const yaw = pawn.state.yaw;
    assert.ok(Math.abs(yaw + Math.PI / 2) < 0.25, `expected to face +X, yaw=${yaw.toFixed(2)}`);
    assert.ok(Math.abs(services().get('characterView').root.children[0].rotation.y - yaw) < 0.3);
    assert.ok(
      pawn.state.position.distanceTo(position) > 5,
      `the player actually travelled (from ${position.x.toFixed(2)},${position.z.toFixed(2)} to ${pawn.state.position.x.toFixed(2)},${pawn.state.position.z.toFixed(2)})`,
    );
  });

  await t.test('Space jumps and the player lands again', () => {
    const start = player().state.position.clone();
    key(window, 'keydown', 'Space');
    advance(game, 0.2);
    key(window, 'keyup', 'Space');

    assert.ok(player().state.position.y > start.y + 0.5, 'airborne after the jump');
    assert.equal(player().state.onGround, false);

    advance(game, 1.5);
    assert.equal(player().state.onGround, true, 'landed');
    assert.ok(
      Math.abs(player().state.position.y - services().get('world').heightAt(player().state.position.x, player().state.position.z)) < 0.05,
    );
  });

  await t.test('the player never ends up inside the world', () => {
    const world = services().get('world');
    const body = player().body;

    // Run into the island boundary for a while, then check we remain on land.
    key(window, 'keydown', 'KeyW');
    advance(game, 3);
    key(window, 'keyup', 'KeyW');

    const { position } = player().state;
    assert.ok(world.isWithinBounds(position.x, position.z, 0), 'inside the map boundary');
    assert.ok(
      world.collider.isClear(position.x, position.z, position.y, body),
      `player is stuck inside geometry at ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`,
    );
  });

  await t.test('mouse drag rotates the camera', () => {
    const cam = camera();
    const yawBefore = cam.yaw;

    const canvas = document.getElementById('game-canvas');
    pointer(canvas, 'pointerdown', { clientX: 600, clientY: 400, pointerType: 'mouse' });
    pointer(window, 'pointermove', { clientX: 900, clientY: 400, pointerType: 'mouse' });
    pointer(window, 'pointerup', { clientX: 900, clientY: 400, pointerType: 'mouse' });
    advance(game, 0.2);

    assert.ok(Math.abs(cam.yaw - yawBefore) > 0.1, `camera yaw changed (${cam.yaw.toFixed(2)})`);

    // Zoom via the wheel.
    const distanceBefore = cam.distance;
    const wheelEvent = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    window.dispatchEvent(wheelEvent);
    advance(game, 0.2);
    assert.ok(cam.distance > distanceBefore, 'wheel zoomed the camera out');
  });

  await t.test('the touch pad drives the same intent as the keyboard', () => {
    const touch = services().get('touchControls');
    const input = services().get('input');

    touch.setVisible(true, { userForced: true });
    assert.equal(touch.visible, true);
    assert.equal(touch.root.classList.contains('touch--hidden'), false);

    const before = player().state.position.clone();

    // Drag the virtual stick upwards: forward.
    pointer(touch.stickZone, 'pointerdown', { clientX: 120, clientY: 500, pointerId: 7 });
    pointer(touch.stickZone, 'pointermove', { clientX: 120, clientY: 420, pointerId: 7 });
    advance(game, 0.05);
    assert.ok(input.intent.move.y > 0.9, `stick wrote a forward intent (${input.intent.move.y})`);
    assert.equal(input.controlMode, 'touch');

    advance(game, 1);
    pointer(touch.stickZone, 'pointerup', { clientX: 120, clientY: 420, pointerId: 7 });
    advance(game, 0.1);

    assert.ok(before.distanceTo(player().state.position) > 3, 'the stick moved the player');
    assert.equal(input.intent.move.y, 0, 'released');

    // Jump button.
    const groundY = player().state.position.y;
    pointer(touch.jumpButton, 'pointerdown', { pointerId: 9 });
    advance(game, 0.2);
    pointer(touch.jumpButton, 'pointerup', { pointerId: 9 });
    assert.ok(player().state.position.y > groundY + 0.3, 'the jump button jumped');

    // Look drag on the right half rotates the camera.
    const yawBefore = camera().yaw;
    pointer(touch.lookZone, 'pointerdown', { clientX: 900, clientY: 300, pointerId: 11 });
    pointer(touch.lookZone, 'pointermove', { clientX: 780, clientY: 300, pointerId: 11 });
    pointer(touch.lookZone, 'pointerup', { clientX: 780, clientY: 300, pointerId: 11 });
    advance(game, 0.2);
    assert.ok(Math.abs(camera().yaw - yawBefore) > 0.05, 'touch look rotated the camera');

    advance(game, 1);
    touch.setVisible(false);
    assert.equal(touch.root.classList.contains('touch--hidden'), true);
  });

  await t.test('pausing freezes the simulation and F3 toggles the debug overlay', () => {
    const position = player().state.position.clone();
    const debug = services().get('debugOverlay');

    assert.equal(debug.visible, false);

    key(window, 'keydown', 'F3');
    advance(game, 0.5);
    assert.equal(debug.visible, true, 'F3 opened the debug overlay');
    assert.ok(debug.content.innerHTML.includes('LAST ZONE'));

    key(window, 'keydown', 'Escape');
    assert.equal(services().get('menu').isOpen, true, 'Escape pauses');
    assert.equal(game.status, 'paused');

    advance(game, 1);
    assert.ok(
      player().state.position.equals(position),
      `frozen while paused (${player().state.position.x.toFixed(3)}, ${player().state.position.y.toFixed(3)}, ${player().state.position.z.toFixed(3)} vs ${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)})`,
    );
    assert.equal(services().get('input').enabled, false);

    // Resume and confirm the simulation runs again.
    document.querySelector('#ui-root .button').click();
    key(window, 'keydown', 'KeyW');
    advance(game, 1);
    key(window, 'keyup', 'KeyW');
    assert.ok(!player().state.position.equals(position), 'resumed');
  });

  await t.test('the player enters once on validated terrain and has no respawn path', () => {
    const world = services().get('world');
    const pawn = services().get('player');
    assert.equal(pawn.spawned, true);
    assert.equal(typeof pawn.respawn, 'undefined');
    assert.equal(typeof services().get('combat').respawnPlayer, 'undefined');

    const spawn = pawn.spawnPoint;
    assert.ok(world.isWithinBounds(spawn.x, spawn.z, pawn.body.radius));
    assert.ok(world.collider.isClear(spawn.x, spawn.z, spawn.y, pawn.body));
    assert.ok(Math.abs(spawn.y - world.heightAt(spawn.x, spawn.z)) < 0.01);
    assert.equal(world.dropRegions.length, 10, 'distributed future drop regions are prepared');
    assert.ok(world.dropRegions.every((region) => region.validated && region.candidates.length > 0));
    for (const region of world.dropRegions) {
      for (const candidate of region.candidates) {
        assert.ok(world.isWithinBounds(candidate.x, candidate.z, pawn.body.radius));
        assert.ok(world.slopeAt(candidate.x, candidate.z) <= 0.48);
        assert.ok(world.collider.isClear(candidate.x, candidate.z, candidate.y, pawn.body));
      }
    }
  });

  game.dispose();
  harness.dom.window.close();
});
