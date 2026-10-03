import { Emitter } from '../core/events.js';
import { INVENTORY } from '../config/settings.js';
import { AMMO_TYPES, ItemKind } from '../loot/items/ItemData.js';
import { lookupItem } from '../loot/items/ItemRegistry.js';

/**
 * The player's loadout - pure data, no scene graph, no DOM.
 *
 * Containers:
 *   - `weapons`     fixed slots (2 by default). A slot holds a live `Weapon`
 *                   instance, so magazine state survives a swap.
 *   - `ammo`        one shared pool per ammo type; every weapon of that type
 *                   reloads from it (this is the BR model: reserve ammo is not
 *                   per weapon).
 *   - `consumables` ordered stacks with quantities; the quick-use keys map to
 *                   the stack order.
 *   - `future`      armor / attachment / cosmetic containers. Already wired so
 *                   Phase C+ items land without an inventory rewrite.
 *
 * Every mutation emits `changed` with a reason, which is what the HUD and the
 * ammo mirror listen to.
 */
export class Inventory extends Emitter {
  constructor({ config = INVENTORY, lookup = lookupItem } = {}) {
    super();
    this.config = config;
    this.lookup = lookup;

    /** @type {Array<import('../combat/weapons/Weapon.js').Weapon|null>} */
    this.weapons = new Array(config.weaponSlots).fill(null);
    this.equippedSlot = 0;
    /** @type {Map<string, number>} ammo type -> rounds */
    this.ammo = new Map();
    /** @type {Array<{itemId:string, quantity:number}>} */
    this.consumables = [];
    this.future = {
      armor: [],
      attachment: [],
      cosmetic: [],
    };
  }

  // ---------------------------------------------------------------- weapons --

  get equippedWeapon() {
    return this.weapons[this.equippedSlot] ?? null;
  }

  get weaponSlots() {
    return this.weapons.length;
  }

  get weaponCount() {
    return this.weapons.filter(Boolean).length;
  }

  hasFreeWeaponSlot() {
    return this.weapons.some((weapon) => !weapon);
  }

  findFreeWeaponSlot() {
    return this.weapons.findIndex((weapon) => !weapon);
  }

  /**
   * @param {object} weapon
   * @param {{slot?:number, equip?:boolean}} [options]
   */
  addWeapon(weapon, { slot = null, equip = false } = {}) {
    const target = slot ?? this.findFreeWeaponSlot();
    if (target < 0 || target >= this.weapons.length) return { added: false, slot: -1, replaced: null };
    const replaced = this.weapons[target];
    this.weapons[target] = weapon;
    if (equip || replaced === null && this.equippedWeapon === null) this.equippedSlot = target;
    this.emit('changed', { reason: 'weapon:add', slot: target });
    return { added: true, slot: target, replaced };
  }

  /** Hard replace - used by the pickup swap flow (the caller drops `replaced`). */
  setWeapon(slot, weapon) {
    if (slot < 0 || slot >= this.weapons.length) return null;
    const replaced = this.weapons[slot];
    this.weapons[slot] = weapon;
    this.emit('changed', { reason: 'weapon:set', slot });
    return replaced;
  }

  removeWeapon(slot = this.equippedSlot) {
    if (slot < 0 || slot >= this.weapons.length) return null;
    const weapon = this.weapons[slot];
    if (!weapon) return null;
    this.weapons[slot] = null;
    this.emit('changed', { reason: 'weapon:remove', slot });
    return weapon;
  }

  equip(slot) {
    if (slot < 0 || slot >= this.weapons.length || slot === this.equippedSlot) return false;
    this.equippedSlot = slot;
    this.emit('changed', { reason: 'weapon:equip', slot });
    return true;
  }

  /** Cycle to the next occupied slot (no-op with a single weapon). */
  swapWeapon() {
    for (let step = 1; step <= this.weapons.length; step += 1) {
      const index = (this.equippedSlot + step) % this.weapons.length;
      if (this.weapons[index]) {
        this.equippedSlot = index;
        this.emit('changed', { reason: 'weapon:equip', slot: index });
        return index;
      }
    }
    return this.equippedSlot;
  }

  /** Slot index of the first weapon that consumes `ammoType` (or -1). */
  slotWithAmmoType(ammoType) {
    return this.weapons.findIndex((weapon) => weapon?.type?.ammoType === ammoType);
  }

  hasWeaponUsingAmmo(ammoType) {
    return this.slotWithAmmoType(ammoType) !== -1;
  }

  // ------------------------------------------------------------------- ammo --

  maxAmmo(ammoType) {
    const definition = AMMO_TYPES[ammoType];
    if (definition?.maxCarry) return definition.maxCarry;
    const itemDefinition = this.lookup(`ammo-${ammoType}`) ?? this.lookup(ammoType);
    return itemDefinition?.stackSize ?? Infinity;
  }

  ammoCount(ammoType) {
    return this.ammo.get(ammoType) ?? 0;
  }

  get totalAmmo() {
    let total = 0;
    for (const count of this.ammo.values()) total += count;
    return total;
  }

  /** @returns {number} how many rounds were actually stored (cap respected). */
  addAmmo(ammoType, amount) {
    if (!(amount > 0)) return 0;
    const max = this.maxAmmo(ammoType);
    const before = this.ammoCount(ammoType);
    const after = Math.min(max, before + amount);
    const applied = after - before;
    if (applied > 0) {
      this.ammo.set(ammoType, after);
      this.emit('changed', { reason: 'ammo:add', ammoType, amount: applied });
    }
    return applied;
  }

  /** @returns {number} how many rounds were actually removed. */
  removeAmmo(ammoType, amount) {
    if (!(amount > 0)) return 0;
    const before = this.ammoCount(ammoType);
    const after = Math.max(0, before - amount);
    const removed = before - after;
    if (removed > 0) {
      if (after === 0) this.ammo.delete(ammoType);
      else this.ammo.set(ammoType, after);
      this.emit('changed', { reason: 'ammo:remove', ammoType, amount: removed });
    }
    return removed;
  }

  // ------------------------------------------------------------ consumables --

  get consumableStacks() {
    return this.consumables;
  }

  consumableCount(itemId) {
    return this.consumables.find((stack) => stack.itemId === itemId)?.quantity ?? 0;
  }

  consumableIndex(itemId) {
    return this.consumables.findIndex((stack) => stack.itemId === itemId);
  }

  stackLimit(itemId) {
    return this.lookup(itemId)?.stackSize ?? 1;
  }

  /**
   * @returns {{added:number, remaining:number}}
   */
  addConsumable(itemId, quantity = 1) {
    if (!(quantity > 0)) return { added: 0, remaining: 0 };
    const limit = this.stackLimit(itemId);
    let stack = this.consumables.find((entry) => entry.itemId === itemId);
    if (!stack) {
      if (this.consumables.length >= this.config.consumableSlots) return { added: 0, remaining: quantity };
      stack = { itemId, quantity: 0 };
      this.consumables.push(stack);
    }
    const room = Math.max(0, limit - stack.quantity);
    const added = Math.min(room, quantity);
    stack.quantity += added;
    if (added > 0) this.emit('changed', { reason: 'consumable:add', itemId, amount: added });
    return { added, remaining: quantity - added };
  }

  /** Remove one (or more) from a stack; empty stacks disappear. */
  removeConsumable(itemId, quantity = 1) {
    const index = this.consumableIndex(itemId);
    if (index < 0) return 0;
    const stack = this.consumables[index];
    const removed = Math.min(stack.quantity, quantity);
    stack.quantity -= removed;
    if (stack.quantity <= 0) this.consumables.splice(index, 1);
    if (removed > 0) this.emit('changed', { reason: 'consumable:remove', itemId, amount: removed });
    return removed;
  }

  /** Stack at a quick-use slot index (0-based, in pickup order). */
  consumableAt(index) {
    return this.consumables[index] ?? null;
  }

  // ------------------------------------------------ future item categories ---

  /** Armor / attachments / cosmetics share one generic container path. */
  addFutureItem(itemId, quantity = 1) {
    const definition = this.lookup(itemId);
    if (!definition) return { added: false, reason: 'unknown-item' };
    const containerKey = containerForKind(definition.kind);
    if (!containerKey) return { added: false, reason: 'unsupported-kind' };
    const container = this.future[containerKey];
    const limit = this.config[`${containerKey}Slots`] ?? 1;
    let entry = container.find((item) => item.itemId === itemId);
    if (!entry) {
      if (container.length >= limit) return { added: false, reason: 'full' };
      entry = { itemId, quantity: 0 };
      container.push(entry);
    }
    const room = Math.max(0, (definition.stackSize ?? 1) - entry.quantity);
    entry.quantity += Math.min(room, quantity);
    this.emit('changed', { reason: `${containerKey}:add`, itemId });
    return { added: entry.quantity > 0, reason: null };
  }

  futureCount(kind) {
    const containerKey = containerForKind(kind);
    if (!containerKey) return 0;
    return this.future[containerKey].reduce((total, item) => total + item.quantity, 0);
  }

  // ------------------------------------------------------------------- misc --

  clear() {
    this.weapons.fill(null);
    this.equippedSlot = 0;
    this.ammo.clear();
    this.consumables.length = 0;
    for (const container of Object.values(this.future)) container.length = 0;
    this.emit('changed', { reason: 'clear' });
  }

  /** Compact snapshot for the HUD (also handy in tests and the debug overlay). */
  toJSON() {
    return {
      equippedSlot: this.equippedSlot,
      weapons: this.weapons.map((weapon) =>
        weapon ? { id: weapon.id, name: weapon.name, magazine: weapon.magazine, reserve: weapon.reserve } : null,
      ),
      ammo: Object.fromEntries(this.ammo),
      consumables: this.consumables.map((stack) => ({ ...stack })),
      future: {
        armor: this.future.armor.length,
        attachment: this.future.attachment.length,
        cosmetic: this.future.cosmetic.length,
      },
    };
  }
}

function containerForKind(kind) {
  switch (kind) {
    case ItemKind.ARMOR:
      return 'armor';
    case ItemKind.ATTACHMENT:
      return 'attachment';
    case ItemKind.COSMETIC:
      return 'cosmetic';
    default:
      return null;
  }
}
