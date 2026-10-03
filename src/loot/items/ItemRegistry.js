import { AMMO_TYPES, ITEMS, ItemKind } from './ItemData.js';
import { getWeaponType, weaponTypes } from '../../combat/weapons/WeaponTypes.js';

/**
 * Item lookup.
 *
 * Loot tables, loot pickups and inventory stacks all reference items by a plain
 * string id. This module is the single place that turns such an id into a
 * definition - and it resolves *weapon* ids too, so a loot table can simply list
 * `'rifle'` next to `'mushroom'` and everything downstream keeps working with
 * one shape:
 *
 *   { id, kind, name, stackSize, visual, tint, ammoType?, weaponType? }
 */

/** Weapons are lootable, so their definitions are projected into item space. */
function weaponItem(weaponType) {
  return Object.freeze({
    id: weaponType.id,
    name: weaponType.name,
    shortName: weaponType.name,
    kind: ItemKind.WEAPON,
    weaponId: weaponType.id,
    weaponType,
    stackSize: 1,
    pickup: { min: 1, max: 1 },
    visual: 'weapon',
    tint: 0x6fd0e8,
    enabled: true,
    description: `${weaponType.magazineSize} round magazine · ${AMMO_TYPES[weaponType.ammoType]?.name ?? weaponType.ammoType ?? 'ammo'}`,
  });
}

/** @type {Map<string, object>} */
export const itemRegistry = new Map();

/** Register (or replace) an item definition at runtime. */
export function registerItem(definition) {
  if (!definition?.id) throw new Error('Item definitions need an id');
  itemRegistry.set(definition.id, Object.freeze({ enabled: true, ...definition }));
  return itemRegistry.get(definition.id);
}

for (const definition of Object.values(ITEMS)) registerItem(definition);

/** Weapons registered later (loot variants) become lootable automatically. */
export function syncWeaponItems() {
  for (const weaponType of Object.values(weaponTypes)) {
    if (!itemRegistry.has(weaponType.id)) registerItem(weaponItem(weaponType));
  }
  return itemRegistry;
}
syncWeaponItems();

/**
 * Resolve any loot id - item or weapon - into a normalised definition.
 * @param {string} id
 * @returns {object|null}
 */
export function lookupItem(id) {
  if (itemRegistry.has(id)) return itemRegistry.get(id);
  if (weaponTypes[id]) return registerItem(weaponItem(weaponTypes[id]));
  return null;
}

/** Same as `lookupItem` but throws - used where an unknown id is a bug. */
export function requireItem(id) {
  const definition = lookupItem(id);
  if (!definition) {
    throw new Error(`Unknown loot item "${id}" (known: ${listItemIds().slice(0, 12).join(', ')}…)`);
  }
  return definition;
}

export function listItemIds({ kind = null, enabled = null } = {}) {
  syncWeaponItems();
  const ids = [];
  for (const definition of itemRegistry.values()) {
    if (kind && definition.kind !== kind) continue;
    if (enabled !== null && Boolean(definition.enabled) !== enabled) continue;
    ids.push(definition.id);
  }
  return ids.sort();
}

/** Usable right now (excludes the disabled future-phase placeholders). */
export function isLootable(id) {
  return Boolean(lookupItem(id)?.enabled);
}

export function ammoTypeOf(id) {
  const definition = lookupItem(id);
  if (definition?.kind === ItemKind.AMMO) return definition.ammoType;
  return definition?.weaponType?.ammoType ?? null;
}

/**
 * What a loot pickup needs: is it a weapon, a stack of consumables or ammo?
 */
export function describeItem(id) {
  const definition = requireItem(id);
  const weapon = definition.weaponId ? getWeaponType(definition.weaponId) : null;
  return {
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    stackSize: definition.stackSize ?? 1,
    visual: definition.visual ?? 'crate',
    tint: definition.tint ?? 0xffffff,
    ammoType: definition.ammoType ?? weapon?.ammoType ?? null,
    weaponType: weapon,
    definition,
  };
}

export { ItemKind, AMMO_TYPES };
