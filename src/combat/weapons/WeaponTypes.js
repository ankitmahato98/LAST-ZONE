import { WEAPONS } from '../../config/settings.js';
import { Weapon } from './Weapon.js';

/**
 * Weapon registry.
 *
 * Adding a weapon:
 *   1. add an entry to `WEAPONS` in `config/settings.js` (ballistics + `model`)
 *   2. add a builder for its `model` in `weapons/WeaponModels.js`
 *   ...that is it. Nothing else in the codebase names a weapon.
 *
 * The registry is intentionally mutable at runtime so a future loot system can
 * register variants ("rifle +extended mag") without touching this file.
 */
export const weaponTypes = { ...WEAPONS };

export function registerWeaponType(type) {
  if (!type?.id) throw new Error('Weapon type needs an id');
  weaponTypes[type.id] = type;
  return type;
}

export function getWeaponType(id) {
  const type = weaponTypes[id];
  if (!type) {
    throw new Error(`Unknown weapon "${id}" (known: ${listWeaponIds().join(', ')})`);
  }
  return type;
}

export function listWeaponIds() {
  return Object.keys(weaponTypes);
}

/**
 * @param {string} id
 * @param {object} [overrides] per-instance ballistics (attachments, variants)
 */
export function createWeapon(id, overrides = {}) {
  const type = { ...getWeaponType(id), ...overrides };
  return new Weapon({ type });
}
