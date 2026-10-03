import test from 'node:test';
import assert from 'node:assert/strict';

import { Collider, BoxBlocker, CircleBlocker } from '../src/physics/Collider.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { CharacterConfig } from '../src/player/CharacterConfig.js';
import { PLAYER } from '../src/config/settings.js';

const STEP = 1 / 60;

/** Flat ground plus whatever solids the test needs. */
function createController({ boxes = [], cylinders = [], spawn = { x: 0, y: 0, z: 0 } } = {}) {
  const heightSampler = { heightAt: () => 0 };
  const collider = new Collider({ heightSampler, boxes, cylinders });
  const world = { collider, heightAt: (x, z) => heightSampler.heightAt(x, z) };
  const config = new CharacterConfig({ spawn });
  const controller = new PlayerController({ world, config });
  controller.placeAt({ x: spawn.x, y: spawn.y, z: spawn.z }, 0);
  return { controller, collider, config };
}

function intent({ forward = 0, right = 0, jump = false, sprint = false } = {}) {
  return {
    move: { x: right, y: forward },
    jumpQueued: jump,
    jumpHeld: jump,
    sprintHeld: sprint,
  };
}

function simulate(controller, seconds, intentFn, cameraYaw = 0) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) controller.update(STEP, intentFn(i), cameraYaw);
}

test('walking forward moves along the camera direction and reaches walk speed', () => {
  const { controller } = createController();
  const start = controller.state.position.clone();

  simulate(controller, 1, () => intent({ forward: 1 }));

  const travelled = start.distanceTo(controller.state.position);
  assert.ok(travelled > 4, `expected ~5m of travel, got ${travelled.toFixed(2)}`);
  assert.ok(controller.state.position.z < start.z, 'yaw 0 walks towards -Z');
  assert.ok(Math.abs(controller.state.speed - PLAYER.walkSpeed) < 0.4);
  assert.equal(controller.state.onGround, true);
});

test('sprinting is faster than walking and strafing is not', () => {
  const walk = createController();
  const run = createController();
  const strafe = createController();

  simulate(walk.controller, 1, () => intent({ forward: 1 }));
  simulate(run.controller, 1, () => intent({ forward: 1, sprint: true }));
  simulate(strafe.controller, 1, () => intent({ right: 1 }));

  assert.ok(run.controller.state.speed > walk.controller.state.speed + 2);
  assert.ok(Math.abs(strafe.controller.state.position.x) > 4);
  assert.ok(Math.abs(strafe.controller.state.position.z) < 0.001, 'pure strafe keeps Z');
});

test('the player stops after the input is released', () => {
  const { controller } = createController();
  simulate(controller, 0.8, () => intent({ forward: 1 }));
  const movingSpeed = controller.state.speed;
  assert.ok(movingSpeed > 4);

  simulate(controller, 1.0, () => intent());
  assert.ok(controller.state.speed < 0.05, `expected to stop, speed ${controller.state.speed}`);
});

test('jumping reaches a sane apex and lands again', () => {
  const { controller } = createController();
  let apex = 0;
  let landed = false;
  controller.events.on('land', () => {
    landed = true;
  });

  for (let i = 0; i < 120; i += 1) {
    controller.update(STEP, intent({ jump: i === 0 }));
    apex = Math.max(apex, controller.state.position.y);
  }

  const expectedApex = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);
  assert.ok(apex > expectedApex * 0.9 && apex <= expectedApex + 0.05, `apex was ${apex.toFixed(2)}`);
  assert.equal(landed, true);
  assert.equal(controller.state.onGround, true);
  assert.ok(Math.abs(controller.state.position.y) < 1e-6, 'back on the ground');
});

test('a jump press just before landing is buffered (jump buffering)', () => {
  const { controller } = createController();

  // Take off.
  controller.update(STEP, intent({ jump: true }));
  assert.equal(controller.state.jumps, 1);
  assert.equal(controller.state.onGround, false);

  // Coast until just before touchdown (the flight lasts ~0.6s).
  simulate(controller, 0.52, () => intent());
  assert.equal(controller.state.onGround, false, 'still airborne');

  // A press while airborne is remembered for jumpBufferTime seconds.
  controller.update(STEP, intent({ jump: true }));
  assert.equal(controller.state.jumps, 1, 'no double jump in the air');

  simulate(controller, 0.25, () => intent());
  assert.equal(controller.state.jumps, 2, 'the buffered press fired on landing');
});

test('a jump requested long before landing is discarded', () => {
  const { controller } = createController();
  controller.update(STEP, intent({ jump: true })); // take off
  controller.update(STEP, intent({ jump: true })); // buffered, but 0.6s early
  simulate(controller, 1.2, () => intent());
  assert.equal(controller.state.jumps, 1);
  assert.equal(controller.state.onGround, true);
});

test('an actor cannot walk through a wall', () => {
  const box = new BoxBlocker({
    center: { x: 0, y: 1.5, z: -5 },
    size: { x: 10, y: 3, z: 1 },
  });
  const { controller } = createController({ boxes: [box] });

  simulate(controller, 2, () => intent({ forward: 1 }));

  const front = -5 + 0.5 + PLAYER.radius;
  assert.ok(
    controller.state.position.z > front - 0.02,
    `expected to stop in front of the wall at z=${front}, got ${controller.state.position.z.toFixed(2)}`,
  );
});

test('sliding along a wall keeps the lateral axis free', () => {
  const box = new BoxBlocker({
    center: { x: 0, y: 1.5, z: -5 },
    size: { x: 10, y: 3, z: 1 },
  });
  const { controller } = createController({ boxes: [box] });

  // Push diagonally into the wall: forward is blocked, right is not.
  const blockedZ = -5 + 0.5 + PLAYER.radius;
  simulate(controller, 1.2, () => intent({ forward: 1, right: 1 }));

  assert.ok(
    Math.abs(controller.state.position.z - blockedZ) < 0.05,
    `expected to be held at the wall (z=${blockedZ}), got ${controller.state.position.z.toFixed(2)}`,
  );
  assert.ok(
    controller.state.position.x > 4,
    `expected to slide along the wall, x=${controller.state.position.x.toFixed(2)}`,
  );
});

test('a low platform is stepped up onto while walking (and off again)', () => {
  const platform = new BoxBlocker({
    center: { x: 0, y: 0.2, z: -4 },
    size: { x: 8, y: 0.4, z: 6 },
    walkable: true,
  });
  const { controller } = createController({ boxes: [platform] });

  // 1s of walking puts the player on top of the platform.
  simulate(controller, 1, () => intent({ forward: 1 }));
  assert.ok(
    Math.abs(controller.state.position.y - 0.4) < 1e-6,
    `expected to stand on the 0.4m platform, y=${controller.state.position.y.toFixed(3)}`,
  );
  assert.ok(controller.state.position.z < -2, 'walked onto the platform');

  // Keep walking and the player steps back down on the far side.
  simulate(controller, 1, () => intent({ forward: 1 }));
  assert.ok(
    Math.abs(controller.state.position.y) < 1e-6,
    `expected to walk back down, y=${controller.state.position.y.toFixed(3)}`,
  );
  assert.ok(controller.state.position.z < -8, 'continued past the platform');
});

test('a crate that is too tall to step over must be jumped onto', () => {
  const crate = new BoxBlocker({
    center: { x: 0, y: 0.5, z: -4 },
    size: { x: 6, y: 1, z: 6 },
    walkable: true,
  });
  const { controller } = createController({ boxes: [crate] });

  // Walking into it: blocked by the 1m lip while standing on the ground.
  simulate(controller, 1.5, () => intent({ forward: 1 }));
  assert.ok(controller.state.position.z > -1.2, 'blocked by the crate lip');
  assert.equal(controller.state.position.y, 0);

  // Jump while running: the feet clear the lip and the crate becomes a floor.
  simulate(controller, 1, (i) => intent({ forward: 1, jump: i === 0 }));
  assert.ok(
    Math.abs(controller.state.position.y - 1) < 1e-6,
    `expected to stand on the crate, y=${controller.state.position.y.toFixed(3)}`,
  );
  assert.ok(controller.state.position.z < -2 && controller.state.position.z > -7, 'on top of the crate');
});

test('cylinders (trees, rocks) block movement', () => {
  const tree = new CircleBlocker({ x: 0, z: -4, radius: 0.6, height: 5 });
  const { controller } = createController({ cylinders: [tree] });

  simulate(controller, 1.5, () => intent({ forward: 1 }));

  const distance = Math.hypot(controller.state.position.x, controller.state.position.z + 4);
  assert.ok(distance >= 0.9, `expected to stay outside the trunk, distance ${distance.toFixed(2)}`);
});

test('the character turns to face the movement direction', () => {
  const { controller } = createController();
  simulate(controller, 1, () => intent({ forward: 1 }));
  assert.ok(Math.abs(controller.state.yaw) < 0.05, 'facing -Z at yaw 0');

  const right = createController();
  simulate(right.controller, 1, () => intent({ right: 1 }));
  // Forward is (-sin yaw, 0, -cos yaw): +X means yaw = -PI/2.
  assert.ok(Math.abs(right.controller.state.yaw + Math.PI / 2) < 0.1);
});

test('steep terrain blocks the movement (no wall climbing)', () => {
  // A height field that rises by 2m per metre beyond z = -2.
  const heightSampler = { heightAt: (x, z) => (z < -2 ? (-z - 2) * 2 : 0) };
  const collider = new Collider({ heightSampler });
  const world = { collider, heightAt: heightSampler.heightAt };
  const controller = new PlayerController({ world, config: new CharacterConfig() });
  controller.placeAt({ x: 0, y: 0, z: 0 }, 0);

  simulate(controller, 3, () => intent({ forward: 1 }));

  assert.ok(controller.state.position.z > -2.6, 'stopped at the slope');
  assert.ok(controller.state.position.y < 1.5, 'did not climb the cliff');
});
