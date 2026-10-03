import test from 'node:test';
import assert from 'node:assert/strict';

import { Vitals } from '../src/combat/Vitals.js';
import { Inventory } from '../src/inventory/Inventory.js';
import { ConsumableUse } from '../src/combat/ConsumableUse.js';
import { createWeapon, registerWeaponType } from '../src/combat/weapons/WeaponTypes.js';
import {
  describeItem,
  isLootable,
  listItemIds,
  lookupItem,
  requireItem,
} from '../src/loot/items/ItemRegistry.js';
import { AMMO_TYPES, ItemKind } from '../src/loot/items/ItemData.js';
import {
  getLootTable,
  listLootTableIds,
  rollLootTable,
  tableForAnchorKind,
} from '../src/loot/LootTables.js';
import { Random } from '../src/utils/rng.js';
import { EP, HEALTH, INVENTORY } from '../src/config/settings.js';

/**
 * Phase B unit tests: the locked HP/EP values, the inventory model, the
 * consumable channel and the loot tables. Everything here is pure logic - no
 * DOM, no scene graph - so the exact numbers from the design are pinned down.
 */

// ===========================================================================
// Locked configuration
// ===========================================================================

test('Phase B locked values are exactly 200 HP / 300 EP / 1 EP = 1 HP / 1 EP per second', () => {
  assert.equal(HEALTH.playerMax, 200);
  assert.equal(EP.max, 300);
  assert.equal(EP.hpPerEnergy, 1, '1 EP is worth 1 HP');
  assert.equal(EP.conversionRate, 1, '1 EP per second');
  assert.equal(EP.autoConvert, false, 'conversion is never passive');

  const vitals = new Vitals();
  assert.equal(vitals.maxHp, 200);
  assert.equal(vitals.maxEnergy, 300);
  assert.equal(vitals.hp, 200, 'spawns at full HP');
  assert.equal(vitals.energy, 0, 'spawns with no EP');
});

// ===========================================================================
// Vitals: HP over EP
// ===========================================================================

test('EP is hard capped at 300 and never regenerates passively', () => {
  const vitals = new Vitals({ maxEnergy: 300 });

  assert.equal(vitals.addEnergy(400), 300, 'one item cannot push past the cap');
  assert.equal(vitals.energy, 300);
  assert.equal(vitals.addEnergy(50), 0, 'already full: nothing applied');

  vitals.consumeEnergy(120);
  assert.equal(vitals.energy, 180);

  // Ten seconds of simulation with conversion off: EP is unchanged.
  for (let i = 0; i < 600; i += 1) vitals.update(1 / 60);
  assert.equal(vitals.energy, 180, 'EP does not regenerate on its own');
  assert.equal(vitals.hp, 200, 'and HP does not change either');
});

test('conversion turns 1 EP into 1 HP per second (150 HP + 100 EP -> 151 / 99)', () => {
  const vitals = new Vitals();
  vitals.health.reset(150);
  vitals.addEnergy(100);

  assert.equal(vitals.startConversion(), true);
  assert.equal(vitals.converting, true);

  vitals.update(1);

  assert.ok(Math.abs(vitals.hp - 151) < 1e-6, `HP should be 151, got ${vitals.hp}`);
  assert.ok(Math.abs(vitals.energy - 99) < 1e-6, `EP should be 99, got ${vitals.energy}`);
  assert.equal(vitals.converting, true, 'still converting');
});

test('conversion stops when HP reaches 200 and never overflows', () => {
  const vitals = new Vitals();
  vitals.health.reset(199.5);
  vitals.addEnergy(50);
  vitals.startConversion();

  vitals.update(1);

  assert.equal(vitals.hp, 200, 'HP is capped at exactly 200');
  assert.equal(vitals.converting, false, 'conversion stopped');
  assert.equal(vitals.stopReason, 'hp-full');
  assert.ok(vitals.energy > 49.4 && vitals.energy <= 49.6, `only 0.5 EP was spent (${vitals.energy})`);

  // Further updates do nothing at all.
  vitals.update(5);
  assert.equal(vitals.hp, 200);
  assert.ok(vitals.energy > 49.4, 'no EP is wasted on a full bar');
});

test('conversion stops when EP runs out', () => {
  const vitals = new Vitals();
  vitals.health.reset(100);
  vitals.addEnergy(0.5);
  vitals.startConversion();

  vitals.update(1);

  assert.equal(vitals.energy, 0);
  assert.ok(Math.abs(vitals.hp - 100.5) < 1e-6);
  assert.equal(vitals.converting, false);
  assert.equal(vitals.stopReason, 'ep-empty');
});

test('conversion cannot start with no EP or full HP, and can be toggled', () => {
  const vitals = new Vitals();
  assert.equal(vitals.canConvert, false, 'full HP and no EP');
  assert.equal(vitals.startConversion(), false);

  vitals.health.reset(180);
  assert.equal(vitals.canConvert, false, 'still no EP');
  vitals.addEnergy(10);
  assert.equal(vitals.canConvert, true);

  assert.equal(vitals.toggleConversion(), true);
  assert.equal(vitals.converting, true);
  assert.equal(vitals.toggleConversion(), true, 'the second toggle stops it');
  assert.equal(vitals.converting, false);
  assert.equal(vitals.stopReason, 'manual');
});

test('damage hits HP only - EP never behaves like extra maximum HP', () => {
  const vitals = new Vitals();
  vitals.health.reset(200);
  vitals.addEnergy(300);

  const result = vitals.applyDamage(70, { source: 'test' });

  assert.equal(result.applied, 70);
  assert.equal(vitals.hp, 130);
  assert.equal(vitals.energy, 300, 'EP is untouched by damage');
  assert.equal(vitals.maxHp, 200, 'EP never raises the maximum');

  // Healing is capped by 200 as well.
  vitals.heal(500);
  assert.equal(vitals.hp, 200);
});

test('elimination stops conversion and cannot be healed through', () => {
  const vitals = new Vitals();
  vitals.health.reset(40);
  vitals.addEnergy(100);
  vitals.startConversion();

  vitals.applyDamage(1000, { source: 'test' });
  assert.equal(vitals.hp, 0);
  assert.equal(vitals.dead, true);

  vitals.update(1);
  assert.equal(vitals.hp, 0, 'no healing after death');
  assert.equal(vitals.converting, false);
  assert.equal(vitals.addEnergy(100), 0, 'no EP for a dead player');
});

// ===========================================================================
// Inventory
// ===========================================================================

test('inventory holds two weapon slots, equips and swaps them', () => {
  assert.equal(INVENTORY.weaponSlots, 2);
  const inventory = new Inventory();
  const rifle = createWeapon('rifle');
  const second = createWeapon('rifle', { damage: 30 }, { magazine: 7 });

  assert.equal(inventory.weaponCount, 0);
  assert.equal(inventory.hasFreeWeaponSlot(), true);

  const first = inventory.addWeapon(rifle);
  assert.equal(first.added, true);
  assert.equal(first.slot, 0);
  assert.equal(inventory.equippedWeapon, rifle, 'the first weapon is equipped');

  const other = inventory.addWeapon(second);
  assert.equal(other.slot, 1);
  assert.equal(inventory.equippedWeapon, rifle, 'picking up a second weapon keeps the first in hand');
  assert.equal(second.magazine, 7, 'a looted weapon keeps its magazine');

  assert.equal(inventory.swapWeapon(), 1);
  assert.equal(inventory.equippedWeapon, second);
  assert.equal(inventory.swapWeapon(), 0);
  assert.equal(inventory.equippedWeapon, rifle);

  assert.equal(inventory.hasFreeWeaponSlot(), false);
  const removed = inventory.removeWeapon(1);
  assert.equal(removed, second);
  assert.equal(inventory.weaponCount, 1);
});

test('ammunition is pooled per type and capped at 300', () => {
  const inventory = new Inventory();

  assert.equal(inventory.ammoCount('556'), 0);
  assert.equal(inventory.addAmmo('556', 45), 45);
  assert.equal(inventory.addAmmo('556', 500), 255, 'the pool stops at 300');
  assert.equal(inventory.ammoCount('556'), AMMO_TYPES['556'].maxCarry);
  assert.equal(inventory.addAmmo('556', 20), 0, 'a full pool accepts nothing');

  assert.equal(inventory.removeAmmo('556', 10), 10);
  assert.equal(inventory.ammoCount('556'), 290);
  assert.equal(inventory.removeAmmo('556', 1000), 290);
  assert.equal(inventory.ammoCount('556'), 0);
  assert.equal(inventory.totalAmmo, 0);
});

test('weapon pickups can be matched to the ammo they consume', () => {
  const inventory = new Inventory();
  assert.equal(inventory.hasWeaponUsingAmmo('556'), false);
  inventory.addWeapon(createWeapon('rifle'));
  assert.equal(inventory.hasWeaponUsingAmmo('556'), true);
  assert.equal(inventory.slotWithAmmoType('556'), 0);
  assert.equal(inventory.slotWithAmmoType('762'), -1);
});

test('consumables stack, respect their stack size and free their slot when empty', () => {
  const inventory = new Inventory();
  const mushroom = requireItem('mushroom');

  assert.deepEqual(inventory.addConsumable('mushroom', 2), { added: 2, remaining: 0 });
  assert.equal(inventory.consumableCount('mushroom'), 2);

  // Overfilling clamps to the item's stack size.
  const overflow = inventory.addConsumable('mushroom', 50);
  assert.equal(overflow.added, mushroom.stackSize - 2);
  assert.ok(overflow.remaining > 0, 'the leftovers are reported, not silently dropped');
  assert.equal(inventory.consumableCount('mushroom'), mushroom.stackSize);

  assert.equal(inventory.removeConsumable('mushroom', mushroom.stackSize), mushroom.stackSize);
  assert.equal(inventory.consumableIndex('mushroom'), -1, 'the empty stack is gone');
});

test('the consumable list is limited to the configured number of stacks', () => {
  const inventory = new Inventory({ config: { ...INVENTORY, consumableSlots: 2 } });
  inventory.addConsumable('mushroom', 1);
  inventory.addConsumable('inhaler', 1);
  const third = inventory.addConsumable('ammo-556', 1);

  assert.equal(inventory.consumableStacks.length, 2);
  assert.equal(third.added, 0, 'no room for a third stack');
  assert.deepEqual(inventory.consumableAt(0), { itemId: 'mushroom', quantity: 1 });
  assert.deepEqual(inventory.consumableAt(1), { itemId: 'inhaler', quantity: 1 });
  assert.equal(inventory.consumableAt(2), null);
});

test('future item categories (armor, attachments, cosmetics) are already wired', () => {
  const inventory = new Inventory();
  const plate = lookupItem('armor-plate-lvl1');

  assert.equal(plate.kind, ItemKind.ARMOR);
  assert.equal(plate.enabled, false, 'not part of the Phase B loot tables yet');

  const result = inventory.addFutureItem('armor-plate-lvl1', 1);
  assert.equal(result.added, true);
  assert.equal(inventory.future.armor.length, 1);
  assert.equal(inventory.futureCount(ItemKind.ARMOR), 1);

  const unknown = inventory.addFutureItem('nope', 1);
  assert.equal(unknown.added, false);
  assert.equal(unknown.reason, 'unknown-item');
});

// ===========================================================================
// Consumables
// ===========================================================================

test('the mushroom pays out EP only, once, at the end of its channel', () => {
  const use = new ConsumableUse();
  const vitals = new Vitals();
  const mushroom = requireItem('mushroom');

  assert.equal(mushroom.use.energy > 0, true);
  assert.equal(mushroom.use.health, 0, 'a mushroom never restores HP directly');

  const started = use.start(mushroom);
  assert.equal(started.started, true);
  assert.equal(use.isActive, true);

  // Halfway through: nothing has been applied yet (instant application).
  use.update(mushroom.use.duration / 2);
  assert.equal(use._paidEnergy, 0);

  const effects = use.update(mushroom.use.duration / 2 + 0.01);
  assert.equal(effects.done, true);
  assert.equal(effects.health, 0);
  assert.equal(effects.energy, mushroom.use.energy);
  assert.equal(use.isActive, false, 'the channel is over');

  vitals.addEnergy(effects.energy);
  assert.equal(vitals.energy, mushroom.use.energy);
});

test('the mushroom cannot push EP past the cap', () => {
  const use = new ConsumableUse();
  const vitals = new Vitals();
  const mushroom = requireItem('mushroom');

  vitals.addEnergy(vitals.maxEnergy - 10);
  use.start(mushroom);
  const effects = use.update(mushroom.use.duration + 0.01);
  vitals.addEnergy(effects.energy);

  assert.equal(vitals.energy, 300, 'clamped at max EP, never 340');
  assert.equal(vitals.hp, 200, 'and HP is untouched');
});

test('the inhaler restores HP and EP gradually and stops at the caps', () => {
  const use = new ConsumableUse();
  const vitals = new Vitals();
  const inhaler = requireItem('inhaler');

  vitals.health.reset(100);
  vitals.addEnergy(0);
  use.start(inhaler);

  // Halfway: roughly half of each resource, never the full amount.
  let health = 0;
  let energy = 0;
  const half = inhaler.use.duration / 2;
  for (let t = 0; t < half; t += 1 / 60) {
    const effects = use.update(1 / 60);
    health += effects.health;
    energy += effects.energy;
  }
  assert.ok(health > inhaler.use.health * 0.4 && health < inhaler.use.health * 0.6, `half HP (${health})`);
  assert.ok(energy > inhaler.use.energy * 0.4 && energy < inhaler.use.energy * 0.6, `half EP (${energy})`);

  // Finish it and apply everything to the vitals.
  let done = false;
  for (let t = 0; t < inhaler.use.duration && !done; t += 1 / 60) {
    const effects = use.update(1 / 60);
    health += effects.health;
    energy += effects.energy;
    done = effects.done;
  }

  assert.equal(done, true);
  assert.ok(Math.abs(health - inhaler.use.health) < 1e-6, `exactly ${inhaler.use.health} HP`);
  assert.ok(Math.abs(energy - inhaler.use.energy) < 1e-6, `exactly ${inhaler.use.energy} EP`);

  vitals.heal(health);
  vitals.addEnergy(energy);
  assert.equal(vitals.hp, 160);
  assert.equal(vitals.energy, inhaler.use.energy);
});

test('the inhaler can never overheal past 200 HP / 300 EP', () => {
  const use = new ConsumableUse();
  const vitals = new Vitals();
  const inhaler = requireItem('inhaler');

  vitals.health.reset(190);
  vitals.addEnergy(290);
  use.start(inhaler);

  for (let t = 0; t <= inhaler.use.duration; t += 1 / 60) {
    const effects = use.update(1 / 60);
    if (!effects) break;
    if (effects.health > 0) vitals.heal(effects.health);
    if (effects.energy > 0) vitals.addEnergy(effects.energy);
  }

  assert.equal(vitals.hp, 200, 'HP stops at 200');
  assert.equal(vitals.energy, 300, 'EP stops at 300');
});

test('a consumable channel is interruptible and only by the listed reasons', () => {
  const use = new ConsumableUse();
  const inhaler = requireItem('inhaler');
  const mushroom = requireItem('mushroom');

  use.start(inhaler);
  assert.equal(use.interrupt('jump'), true, 'jumping cancels the inhaler');
  assert.equal(use.isActive, false);

  use.start(mushroom);
  assert.equal(use.interrupt('fire'), false, 'a mushroom tolerates firing');
  assert.equal(use.isActive, true);
  assert.equal(use.interrupt('damage'), true, 'but not taking a hit');
  assert.equal(use.isActive, false);

  // One channel at a time.
  use.start(mushroom);
  assert.equal(use.start(inhaler).started, false);
  assert.deepEqual(use.start(inhaler).reason, 'busy');
  use.cancel('test');
  assert.equal(use.isActive, false);
});

// ===========================================================================
// Item registry + loot tables
// ===========================================================================

test('the item registry resolves consumables, ammo and weapons through one id space', () => {
  assert.ok(lookupItem('mushroom'));
  assert.ok(lookupItem('inhaler'));
  assert.ok(lookupItem('ammo-556'));

  const rifle = lookupItem('rifle');
  assert.equal(rifle.kind, ItemKind.WEAPON, 'weapons are loot too');
  assert.equal(rifle.stackSize, 1);

  assert.equal(describeItem('ammo-556').ammoType, '556');
  assert.equal(describeItem('mushroom').visual, 'mushroom');
  assert.equal(isLootable('armor-plate-lvl1'), false, 'future items are not in world loot yet');
  assert.equal(toThrow(() => requireItem('does-not-exist')), 'threw');
});

function toThrow(fn) {
  try {
    fn();
    return 'no-throw';
  } catch {
    return 'threw';
  }
}

test('every enabled item is fully described and usable by the loot system', () => {
  const ids = listItemIds({ enabled: true });
  assert.ok(ids.length >= 4, `expected lootable items, got ${ids.length}`);
  assert.ok(ids.includes('rifle'), 'weapons are lootable items');

  for (const id of ids) {
    const description = describeItem(id);
    assert.ok(description.name, `${id} has a name`);
    assert.ok(description.stackSize >= 1, `${id} has a stack size`);
    assert.ok(description.visual, `${id} has a world visual`);
    assert.ok(Number.isInteger(description.tint), `${id} has a tint`);
  }

  // The future categories exist and are parked, not missing.
  const future = listItemIds({ enabled: false });
  assert.ok(future.includes('armor-plate-lvl1'));
  assert.ok(future.includes('attachment-extended-mag'));
  assert.ok(future.includes('cosmetic-emblem'));
});

test('a registered weapon becomes lootable without touching the loot code', () => {
  registerWeaponType({
    id: 'test-carbine',
    name: 'Test Carbine',
    kind: 'hitscan',
    automatic: false,
    ammoType: '556',
    damage: 18,
    magazineSize: 12,
    reserveAmmo: 60,
    reloadTime: 1.4,
    range: 90,
    fireRate: 4,
    spread: { standing: 0.01, moving: 0.03, aiming: 0.005, perShot: 0.004, max: 0.05, recovery: 3 },
    recoil: { vertical: 0.01, horizontal: 0.004 },
    model: 'rifle',
  });

  const definition = lookupItem('test-carbine');
  assert.equal(definition.kind, ItemKind.WEAPON);
  assert.equal(describeItem('test-carbine').ammoType, '556');

  const weapon = createWeapon('test-carbine', {}, { magazine: 5, reserve: 0 });
  assert.equal(weapon.magazine, 5, 'state carries over from the world pickup');
  assert.equal(weapon.ammoType, '556');
});

test('loot tables are deterministic per anchor but not identical across anchors', () => {
  const roll = (anchorId) => rollLootTable('warehouse', new Random(`seed:loot:${anchorId}`));

  const a = roll('warehouse-1');
  const b = roll('warehouse-1');
  assert.deepEqual(a, b, 'the same anchor always rolls the same loot');

  const layouts = new Set();
  for (let i = 0; i < 40; i += 1) {
    layouts.add(JSON.stringify(roll(`anchor-${i}`).map((drop) => `${drop.id}x${drop.quantity}`)));
  }
  assert.ok(layouts.size > 5, `anchors produce varied loot (${layouts.size} layouts / 40 anchors)`);
});

test('every loot table only rolls enabled, resolvable ids', () => {
  for (const tableId of listLootTableIds()) {
    for (let seed = 0; seed < 12; seed += 1) {
      const drops = rollLootTable(tableId, new Random(`${tableId}:${seed}`));
      assert.ok(drops.length > 0, `${tableId} always drops something`);
      for (const drop of drops) {
        assert.ok(lookupItem(drop.id), `${tableId} rolled an unknown id "${drop.id}"`);
        assert.equal(isLootable(drop.id), true, `${tableId} rolled the disabled item "${drop.id}"`);
        assert.ok(drop.quantity >= 1, `${tableId} rolled a positive quantity`);
      }
    }
  }
});

test('the arrival stash always guarantees a weapon, military loot is the richest', () => {
  const stash = getLootTable('spawn-stash');
  assert.ok(stash.guaranteed.some((entry) => entry.id === 'rifle'), 'the plaza always has a rifle');

  for (let seed = 0; seed < 20; seed += 1) {
    const drops = rollLootTable('spawn-stash', new Random(`stash:${seed}`));
    assert.ok(drops.some((drop) => drop.id === 'rifle'), 'the guarantee holds on every roll');
  }

  const weaponWeight = (tableId) => {
    const entry = getLootTable(tableId).entries.find((candidate) => candidate.id === 'rifle');
    return entry?.weight ?? 0;
  };
  assert.ok(
    weaponWeight('military') > weaponWeight('residential'),
    'military areas are worth fighting for',
  );

  // Anchor kinds map to tables, with a safe fallback.
  assert.equal(tableForAnchorKind('military'), 'military');
  assert.equal(tableForAnchorKind('house'), 'residential');
  assert.equal(tableForAnchorKind('nonsense'), 'supply');
});
