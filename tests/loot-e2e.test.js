import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom, pointer, key, advance } from './helpers/dom.js';
import { headlessRendererFactory } from './helpers/headlessRenderer.js';
import { LOOT } from '../src/config/settings.js';

/**
 * Phase B end to end, through the *real* game wiring.
 *
 * Everything goes through the same entry points a player uses: keyboard edges for
 * desktop, pointer events on the touch pad for mobile, and the shared input
 * intent in between. Nothing calls a private loot or inventory method to make a
 * pickup happen.
 */
const harness = installDom();

let game;
let window;
let document;
let services;
let loot;
let inventorySystem;
let inventory;
let vitals;
let combat;
let player;

const S = (name) => services.get(name);

/** Stand somewhere open and clear the map loot out of interaction range. */
function isolateAt(x = null, z = null) {
  if (x !== null) player.teleport(x, z);
  advance(game, 2 / 60);
  const position = player.position;
  for (const pickup of loot.pickups) {
    if (!pickup.active) continue;
    if (Math.hypot(pickup.position.x - position.x, pickup.position.z - position.z) < 6) {
      loot.takePickup(pickup, { silent: true });
    }
  }
  advance(game, 2 / 60);
}

/** Spawn a world pickup right in front of the player (the drop path). */
function placeNear(lootId, { quantity = 1, state = null } = {}) {
  const pickup = loot.dropAtFeet(lootId, player.position, player.yaw ?? 0, quantity, state);
  assert.ok(pickup, `dropped ${lootId}`);
  advance(game, 3 / 60);
  return pickup;
}

function press(keys, seconds = 0.1) {
  for (const code of keys) key(window, 'keydown', code);
  advance(game, seconds);
  for (const code of keys) key(window, 'keyup', code);
  advance(game, 2 / 60);
}

test('Phase B: loot, inventory, HP/EP and consumables end to end', async (t) => {
  const { createGame } = await import('../src/core/engine.js');
  window = globalThis.window;
  document = globalThis.document;

  const { game: instance } = await createGame({
    canvas: document.getElementById('game-canvas'),
    uiRoot: document.getElementById('ui-root'),
    rendererFactory: headlessRendererFactory,
  });
  game = instance;
  game.start();
  game.loop.stop();
  services = game.services;

  loot = S('loot');
  inventorySystem = S('inventory');
  inventory = inventorySystem.inventory;
  vitals = S('vitals');
  combat = S('combat');
  player = S('player');

  await t.test('the island is dressed with loot: buildings, cover and the arrival plaza', () => {
    const world = S('world');
    assert.ok(world.stats.lootAnchors > 60, `expected many loot anchors, got ${world.stats.lootAnchors}`);
    assert.ok(world.stats.indoorLootAnchors > 30, 'interiors hold loot');
    assert.ok(loot.anchors.length > 60, 'validated anchors become real loot spots');
    assert.ok(loot.pickups.length > 120, `expected a loot-rich island, got ${loot.pickups.length}`);

    // Every POI got something, and the categories are all present.
    const poiIds = new Set(loot.pickups.map((pickup) => pickup.anchorId?.split('-')[0]));
    assert.ok(poiIds.size >= 5, `loot is spread across the island (${poiIds.size} anchor groups)`);
    const kinds = loot.stats.byKind;
    assert.ok(kinds.weapon > 10, 'weapons exist in the world');
    assert.ok(kinds.ammo > 10, 'ammunition exists in the world');
    assert.ok(kinds.consumable > 10, 'consumables exist in the world');

    // Rendering budget: a handful of instanced meshes, not hundreds of meshes.
    assert.ok(loot.stats.instancedMeshes < 40, `instanced meshes: ${loot.stats.instancedMeshes}`);
  });

  await t.test('Enter Island starts the run with empty hands', () => {
    document.querySelector('#ui-root .button').click();
    advance(game, 0.5);

    assert.equal(combat.weapon, null, 'no weapon until one is found');
    assert.equal(vitals.hp, 200);
    assert.equal(vitals.maxEnergy, 300);
    assert.equal(vitals.energy, 0);
  });

  await t.test('desktop: a weapon crate shows a prompt and E picks it up', () => {
    isolateAt();
    const crate = placeNear('rifle');

    // The prompt appears with the item's name before anything is pressed.
    assert.equal(inventorySystem.nearby.id, crate.id, 'the crate is the nearest pickup');
    assert.equal(inventorySystem.prompt.action, 'pickup');
    assert.equal(inventorySystem.prompt.name, 'AR-4 Ranger');

    const hud = document.querySelector('.prompt');
    assert.equal(hud.classList.contains('prompt--hidden'), false, 'the HUD prompt is visible');
    assert.ok(document.querySelector('.prompt__name').textContent.includes('AR-4 Ranger'));
    assert.equal(document.querySelector('.prompt__action').textContent, 'PICK UP');

    press(['KeyE']);

    assert.equal(crate.active, false, 'the crate left the world');
    assert.ok(combat.weapon, 'and the weapon is in hand');
    assert.equal(combat.weapon.id, 'rifle');
    assert.equal(inventory.weaponCount, 1);
    assert.equal(inventory.equippedWeapon, combat.weapon, 'the inventory and combat agree');
    assert.equal(combat.ammo.magazine, combat.weapon.magazineSize, 'looted weapons come loaded');
    assert.equal(document.querySelector('.prompt').classList.contains('prompt--hidden'), true, 'the prompt went away');
  });

  await t.test('desktop: ammunition is collected into the shared pool', () => {
    isolateAt();
    const box = placeNear('ammo-556', { quantity: 30 });
    const before = inventory.ammoCount('556');

    assert.equal(inventorySystem.prompt.name, '5.56mm Ammo');
    press(['KeyE']);

    assert.equal(box.active, false);
    assert.equal(inventory.ammoCount('556'), before + 30, 'the rounds went into the pool');
    assert.equal(combat.ammo.reserve, inventory.ammoCount('556'), 'the equipped weapon mirrors the pool');
  });

  await t.test('desktop: consumables are picked up and quick-used with the digit keys', () => {
    isolateAt();
    const mushroom = placeNear('mushroom');
    press(['KeyE']);
    assert.equal(mushroom.active, false);
    assert.equal(inventory.consumableCount('mushroom') >= 1, true, 'the mushroom is in the inventory');

    // Clear the stacks so the quick-use slot indexes are predictable.
    while (inventory.consumableStacks.length > 0) {
      const stack = inventory.consumableAt(0);
      inventory.removeConsumable(stack.itemId, 99);
    }
    inventory.addConsumable('mushroom', 2);
    vitals.reset({ health: 120, energy: 0 });

    press(['Digit1']);

    assert.equal(inventorySystem.using, true, 'the channel started');
    assert.equal(inventorySystem.usingItemId, 'mushroom');
    assert.equal(inventory.consumableCount('mushroom'), 1, 'the item is consumed up front');
    const channel = document.querySelector('.channel');
    assert.equal(channel.classList.contains('channel--hidden'), false, 'the HUD shows the progress bar');

    advance(game, 1.3); // longer than the mushroom's 1.1s channel

    assert.equal(inventorySystem.using, false, 'the channel completed');
    assert.equal(vitals.energy, 40, 'the mushroom added EP');
    assert.equal(vitals.hp, 120, 'and never HP');
    assert.equal(channel.classList.contains('channel--hidden'), true);
  });

  await t.test('mushrooms cannot push EP past 300', () => {
    vitals.reset({ health: 200, energy: 285 });
    inventorySystem.useConsumable('mushroom');
    advance(game, 1.3);

    assert.equal(vitals.energy, 300, 'clamped at the EP maximum');
  });

  await t.test('the inhaler heals HP and EP gradually and is interrupted by damage', () => {
    isolateAt();
    while (inventory.consumableStacks.length > 0) {
      inventory.removeConsumable(inventory.consumableAt(0).itemId, 99);
    }
    const inhaler = placeNear('inhaler');
    press(['KeyE']);
    assert.equal(inhaler.active, false);
    assert.equal(inventory.consumableCount('inhaler'), 1);

    // --- gradual restoration ---------------------------------------------
    vitals.reset({ health: 100, energy: 0 });
    combat.protectionTimer = 0;
    inventorySystem.useConsumable('inhaler');
    assert.equal(inventorySystem.using, true);

    advance(game, 1.6); // half of the 3.2s channel
    assert.ok(vitals.hp > 110 && vitals.hp < 150, `partial heal mid-channel (${vitals.hp.toFixed(1)})`);
    assert.ok(vitals.energy > 5 && vitals.energy < 45, `partial EP mid-channel (${vitals.energy.toFixed(1)})`);

    advance(game, 1.8);
    assert.equal(inventorySystem.using, false, 'the channel completed');
    assert.equal(Math.round(vitals.hp), 160, 'exactly the configured HP');
    assert.equal(Math.round(vitals.energy), 45, 'exactly the configured EP');
    assert.ok(vitals.hp <= 200 && vitals.energy <= 300, 'never above the caps');

    // --- interruptible ----------------------------------------------------
    inventory.addConsumable('inhaler', 1);
    vitals.reset({ health: 100, energy: 0 });
    const stored = inventory.consumableCount('inhaler');
    inventorySystem.useConsumable('inhaler');
    advance(game, 1);
    const healthAtInterrupt = vitals.hp;

    combat.damagePlayer(10, { source: 'test' });

    assert.equal(inventorySystem.using, false, 'taking a hit cancelled the channel');
    assert.ok(healthAtInterrupt > 100, 'the effect already applied is kept');
    assert.ok(vitals.hp >= healthAtInterrupt - 10, 'and the damage lands');
    assert.equal(inventory.consumableCount('inhaler'), stored - 1, 'the item was spent, not refunded');

    const before = vitals.hp;
    advance(game, 2.5);
    assert.equal(vitals.hp, before, 'an interrupted inhaler stops healing');
  });

  await t.test('EP converts into HP at 1 EP per second and stops at 200 HP', () => {
    isolateAt();
    vitals.reset({ health: 150, energy: 100 });
    combat.protectionTimer = 0;

    press(['KeyC'], 1 / 60);
    assert.equal(vitals.converting, true, 'C starts the conversion');

    // Measure from the moment the conversion is live: 1 EP -> 1 HP per second.
    const hpAtStart = vitals.hp;
    const epAtStart = vitals.energy;
    advance(game, 1);
    assert.ok(
      Math.abs(vitals.hp - (hpAtStart + 1)) < 0.05,
      `after 1s HP grew by 1 (${hpAtStart} -> ${vitals.hp.toFixed(2)})`,
    );
    assert.ok(
      Math.abs(vitals.energy - (epAtStart - 1)) < 0.05,
      `after 1s EP dropped by 1 (${epAtStart} -> ${vitals.energy.toFixed(2)})`,
    );

    advance(game, 60); // enough to drain the bar
    assert.equal(vitals.hp, 200, 'conversion stops at max HP');
    assert.equal(vitals.converting, false);
    assert.ok(Math.abs(vitals.energy - 50) < 0.5, `only 50 EP was spent (${vitals.energy.toFixed(2)})`);

    // And it never regenerates passively afterwards.
    advance(game, 5);
    assert.equal(vitals.energy, vitals.energy, 'EP is not regenerated by time');
    assert.ok(vitals.energy <= 50.5, 'no surprise EP gains');
  });

  await t.test('damage only reduces HP - EP stays a spendable buffer', () => {
    vitals.reset({ health: 200, energy: 200 });
    combat.protectionTimer = 0;

    const result = combat.damagePlayer(60, { source: 'test' });

    assert.equal(result.applied, 60);
    assert.equal(vitals.hp, 140);
    assert.equal(vitals.energy, 200, 'EP is untouched by incoming damage');
    assert.equal(vitals.maxHp, 200, 'EP never raises the maximum HP');

    // Fall damage flows into the same HP pool.
    combat._applyFallDamage(24);
    assert.ok(vitals.hp < 140, 'fall damage hurt');
    assert.equal(vitals.energy, 200);
  });

  await t.test('weapon pickup fills the second slot, and a third weapon swaps', () => {
    isolateAt();
    // Slot 0 already holds the rifle from the first pickup test.
    assert.equal(inventory.weaponCount, 1);

    const second = placeNear('rifle', { state: { magazine: 11 } });
    press(['KeyE']);

    assert.equal(second.active, false);
    assert.equal(inventory.weaponCount, 2, 'the free slot took the second weapon');
    assert.equal(combat.weapon.magazine, 11, 'looted magazine state came along');

    // --- a third weapon has nowhere to go: it swaps with the one in hand ---
    const third = placeNear('rifle', { state: { magazine: 4 } });
    assert.equal(inventorySystem.prompt.action, 'swap', 'the prompt offers a swap');
    assert.equal(document.querySelector('.prompt__action').textContent, 'SWAP');

    const equippedBefore = combat.weapon;
    press(['KeyE']);

    assert.equal(third.active, false);
    assert.equal(inventory.weaponCount, 2, 'still two slots');
    assert.equal(combat.weapon.magazine, 4, 'the new weapon is in hand');
    assert.notEqual(combat.weapon, equippedBefore);

    const dropped = loot.pickups.find((pickup) => pickup.dropped && pickup.active && pickup.state?.magazine === 11);
    assert.ok(dropped, 'the swapped-out weapon became a world pickup');
    assert.equal(dropped.state.magazine, 11, 'with its magazine preserved');
  });

  await t.test('X swaps weapon slots and both weapons keep their magazines', () => {
    const before = combat.weapon;
    const slotBefore = inventory.equippedSlot;

    press(['KeyX']);

    assert.notEqual(inventory.equippedSlot, slotBefore, 'the active slot changed');
    assert.notEqual(combat.weapon, before);
    assert.equal(inventory.equippedWeapon, combat.weapon, 'the inventory followed the swap');
    assert.equal(combat.ammo.magazine, combat.weapon.magazine, 'the HUD reads the new weapon');

    // Swapping back restores the first weapon exactly as it was.
    press(['KeyX']);
    assert.equal(combat.weapon, before, 'back to the first weapon');
    assert.equal(combat.weapon.magazine, before.magazine, 'its magazine survived');
  });

  await t.test('G drops the equipped weapon into the world as a real pickup', () => {
    const equipped = combat.weapon;
    const count = inventory.weaponCount;
    const drops = [];
    const off = game.bus.on('weapon:drop', (payload) => drops.push(payload));

    press(['KeyG']);
    off();

    assert.equal(inventory.weaponCount, count - 1, 'the slot is empty');
    assert.equal(drops.length, 1);
    const dropped = loot.getPickup(drops[0].pickup);
    assert.ok(dropped?.active, 'the weapon is lying in the world');
    assert.equal(dropped.lootId, equipped.id);
    assert.equal(dropped.state.magazine, equipped.magazine, 'with its magazine');
    assert.equal(combat.weapon, inventory.equippedWeapon, 'combat and inventory stay in sync');
    if (count > 1) assert.ok(combat.weapon, 'the other slot took over automatically');

    // ...and it can be picked straight back up.
    press(['KeyE']);
    assert.equal(inventory.weaponCount, count, 'picked back up');
    assert.ok(combat.weapon, 'and it is in hand');
  });

  await t.test('a weapon reloads from the shared ammunition pool', () => {
    inventory.addAmmo('556', 60);
    advance(game, 1 / 60);
    combat.weapon.magazine = 3;

    const pool = inventory.ammoCount('556');
    press(['KeyR']);
    assert.equal(combat.isReloading, true);

    advance(game, combat.weapon.type.reloadTime + 0.1);
    assert.equal(combat.ammo.magazine, combat.weapon.magazineSize);
    assert.ok(inventory.ammoCount('556') < pool, 'the rounds came out of the inventory pool');
    assert.equal(combat.ammo.reserve, inventory.ammoCount('556'), 'the mirror stayed exact');
  });

  await t.test('mobile: a contextual button picks loot up on touch, and hides when empty', () => {
    const touch = S('touchControls');
    touch.setVisible(true, { userForced: true });
    isolateAt();

    assert.equal(touch.interactButton.classList.contains('touch--hidden'), true, 'hidden with nothing near');

    const box = placeNear('ammo-556', { quantity: 25 });
    advance(game, 3 / 60);

    assert.equal(touch.interactButton.classList.contains('touch--hidden'), false, 'the button appeared');
    assert.equal(touch.interactButton.textContent, 'Pick up');

    const before = inventory.ammoCount('556');
    pointer(touch.interactButton, 'pointerdown', { pointerId: 41, pointerType: 'touch' });
    pointer(touch.interactButton, 'pointerup', { pointerId: 41, pointerType: 'touch' });
    advance(game, 3 / 60);

    assert.equal(box.active, false, 'the touch button picked the box up');
    assert.equal(inventory.ammoCount('556'), before + 25);

    // The quick-use buttons mirror the inventory.
    while (inventory.consumableStacks.length > 0) {
      inventory.removeConsumable(inventory.consumableAt(0).itemId, 99);
    }
    inventory.addConsumable('mushroom', 1);
    touch._syncLoadout();
    assert.equal(touch.itemButtons[0].classList.contains('touch--hidden'), false, 'a use button is shown');
    assert.ok(touch.itemButtons[0].textContent.includes('Mushroom'));

    vitals.reset({ health: 180, energy: 10 });
    pointer(touch.itemButtons[0], 'pointerdown', { pointerId: 42, pointerType: 'touch' });
    pointer(touch.itemButtons[0], 'pointerup', { pointerId: 42, pointerType: 'touch' });
    advance(game, 1.4);
    assert.equal(vitals.energy, 50, 'the touch use button ate the mushroom');
    assert.equal(inventory.consumableCount('mushroom'), 0);

    touch.setVisible(false);
  });

  await t.test('mobile: the convert button turns EP into HP on touch', () => {
    const touch = S('touchControls');
    touch.setVisible(true, { userForced: true });
    vitals.reset({ health: 100, energy: 60 });
    touch.update();

    assert.equal(touch.convertButton.classList.contains('touch--hidden'), false, 'the convert button is offered');
    pointer(touch.convertButton, 'pointerdown', { pointerId: 43, pointerType: 'touch' });
    pointer(touch.convertButton, 'pointerup', { pointerId: 43, pointerType: 'touch' });
    advance(game, 2 / 60);

    assert.equal(vitals.converting, true);
    advance(game, 10);
    assert.ok(vitals.hp > 105, `HP grew from the conversion (${vitals.hp.toFixed(1)})`);
    touch.setVisible(false);
  });

  await t.test('elimination is permanent and locks every Phase B interaction', () => {
    isolateAt();
    const box = placeNear('ammo-556', { quantity: 20 });
    const before = inventory.ammoCount('556');

    combat.protectionTimer = 0;
    combat.damagePlayer(1000, { source: 'test' });
    advance(game, 0.2);

    assert.equal(vitals.hp, 0);
    assert.equal(combat.isEliminated, true);
    assert.equal(typeof player.respawn, 'undefined', 'there is no respawn function');
    assert.equal(typeof combat.respawnPlayer, 'undefined');

    // Every interaction is refused after elimination.
    press(['KeyE']);
    press(['Digit1']);
    press(['KeyC']);
    assert.equal(box.active, true, 'nothing can be picked up while eliminated');
    assert.equal(inventorySystem.using, false, 'no consumables while eliminated');
    assert.equal(vitals.converting, false, 'no conversion while eliminated');
    assert.equal(inventory.ammoCount('556'), before);

    // Health never comes back on its own.
    advance(game, 10);
    assert.equal(vitals.hp, 0);
    assert.equal(vitals.energy, vitals.energy);

    // The HUD says so.
    S('inventoryHud').update(1 / 60);
    assert.equal(document.querySelector('.banner').classList.contains('banner--hidden'), false);
    assert.ok(document.querySelector('.banner__sub').textContent.includes('out for this run'));
  });

  game.dispose();
  harness.dom.window.close();
});
