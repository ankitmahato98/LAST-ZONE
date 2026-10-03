/**
 * Loot tables.
 *
 * A table describes *what* can be found; the world anchors (see
 * `world/IslandMap.js` + `world/WorldSystem.js`) describe *where*. Keeping the
 * two apart means a POI can be re-dressed without touching a single weight, and
 * a new location type is one entry in `TABLE_BY_ANCHOR_KIND`.
 *
 * Every table is rolled with a `Random` seeded from the anchor id, so a given
 * map always produces the same loot layout while different anchors - and
 * different anchors of the same kind - still roll different contents.
 *
 * Entry shape:
 *   { id, weight, min?, max? }
 * where `id` is any registered loot id (weapon or item). Weapons ignore
 * `min`/`max`: a weapon is always a single object.
 */

/** Anchor kind -> table id. Anchor kinds are produced by the world builders. */
export const TABLE_BY_ANCHOR_KIND = Object.freeze({
  store: 'commercial',
  house: 'residential',
  warehouse: 'warehouse',
  military: 'military',
  dock: 'harbor',
  camp: 'camp',
  utility: 'utility',
  quarry: 'industrial',
  farm: 'farm',
  landmark: 'landmark',
  crate: 'supply',
  medical: 'medical',
  stash: 'spawn-stash',
  roadside: 'roadside',
});

export const LOOT_TABLES = Object.freeze({
  /** Guaranteed starting kit: one rifle plus the ammo to use it. */
  'spawn-stash': Object.freeze({
    id: 'spawn-stash',
    label: 'Arrival stash',
    rolls: [1, 2],
    guaranteed: Object.freeze([{ id: 'rifle', quantity: 1 }]),
    entries: Object.freeze([
      { id: 'ammo-556', weight: 10, min: 30, max: 60 },
      { id: 'mushroom', weight: 5, min: 1, max: 2 },
      { id: 'inhaler', weight: 4, min: 1, max: 1 },
      { id: 'rifle', weight: 2 },
    ]),
  }),

  residential: Object.freeze({
    id: 'residential',
    label: 'Residential',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 8, min: 15, max: 30 },
      { id: 'mushroom', weight: 7, min: 1, max: 2 },
      { id: 'inhaler', weight: 3, min: 1, max: 1 },
      { id: 'rifle', weight: 1 },
    ]),
  }),

  commercial: Object.freeze({
    id: 'commercial',
    label: 'Commercial',
    rolls: [2, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 7, min: 20, max: 40 },
      { id: 'mushroom', weight: 6, min: 1, max: 2 },
      { id: 'inhaler', weight: 6, min: 1, max: 2 },
      { id: 'rifle', weight: 2 },
    ]),
  }),

  warehouse: Object.freeze({
    id: 'warehouse',
    label: 'Warehouse',
    rolls: [2, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 10, min: 25, max: 50 },
      { id: 'rifle', weight: 3 },
      { id: 'inhaler', weight: 3, min: 1, max: 1 },
      { id: 'mushroom', weight: 2, min: 1, max: 1 },
    ]),
  }),

  military: Object.freeze({
    id: 'military',
    label: 'Military',
    rolls: [2, 4],
    entries: Object.freeze([
      { id: 'rifle', weight: 6 },
      { id: 'ammo-556', weight: 11, min: 30, max: 60 },
      { id: 'inhaler', weight: 4, min: 1, max: 2 },
      { id: 'mushroom', weight: 2, min: 1, max: 1 },
    ]),
  }),

  medical: Object.freeze({
    id: 'medical',
    label: 'Medical',
    rolls: [2, 3],
    entries: Object.freeze([
      { id: 'inhaler', weight: 12, min: 1, max: 2 },
      { id: 'mushroom', weight: 5, min: 1, max: 2 },
      { id: 'ammo-556', weight: 2, min: 10, max: 25 },
    ]),
  }),

  harbor: Object.freeze({
    id: 'harbor',
    label: 'Harbor',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 9, min: 20, max: 45 },
      { id: 'mushroom', weight: 5, min: 1, max: 2 },
      { id: 'inhaler', weight: 4, min: 1, max: 1 },
      { id: 'rifle', weight: 2 },
    ]),
  }),

  camp: Object.freeze({
    id: 'camp',
    label: 'Forest camp',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'mushroom', weight: 10, min: 1, max: 3 },
      { id: 'ammo-556', weight: 6, min: 15, max: 30 },
      { id: 'rifle', weight: 2 },
      { id: 'inhaler', weight: 2, min: 1, max: 1 },
    ]),
  }),

  utility: Object.freeze({
    id: 'utility',
    label: 'Utility',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 8, min: 20, max: 40 },
      { id: 'inhaler', weight: 5, min: 1, max: 1 },
      { id: 'mushroom', weight: 4, min: 1, max: 1 },
      { id: 'rifle', weight: 2 },
    ]),
  }),

  industrial: Object.freeze({
    id: 'industrial',
    label: 'Industrial',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 9, min: 20, max: 40 },
      { id: 'mushroom', weight: 5, min: 1, max: 1 },
      { id: 'rifle', weight: 3 },
      { id: 'inhaler', weight: 3, min: 1, max: 1 },
    ]),
  }),

  farm: Object.freeze({
    id: 'farm',
    label: 'Farm',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'mushroom', weight: 9, min: 1, max: 2 },
      { id: 'inhaler', weight: 4, min: 1, max: 1 },
      { id: 'ammo-556', weight: 6, min: 15, max: 30 },
      { id: 'rifle', weight: 1 },
    ]),
  }),

  landmark: Object.freeze({
    id: 'landmark',
    label: 'Landmark',
    rolls: [2, 3],
    entries: Object.freeze([
      { id: 'rifle', weight: 4 },
      { id: 'ammo-556', weight: 8, min: 25, max: 50 },
      { id: 'inhaler', weight: 5, min: 1, max: 2 },
      { id: 'mushroom', weight: 4, min: 1, max: 2 },
    ]),
  }),

  /** Outdoor cover crates: ammunition-heavy. */
  supply: Object.freeze({
    id: 'supply',
    label: 'Supply crate',
    rolls: [1, 3],
    entries: Object.freeze([
      { id: 'ammo-556', weight: 12, min: 20, max: 45 },
      { id: 'mushroom', weight: 4, min: 1, max: 1 },
      { id: 'inhaler', weight: 3, min: 1, max: 1 },
      { id: 'rifle', weight: 2 },
    ]),
  }),

  roadside: Object.freeze({
    id: 'roadside',
    label: 'Roadside',
    rolls: [1, 2],
    entries: Object.freeze([
      { id: 'mushroom', weight: 7, min: 1, max: 2 },
      { id: 'ammo-556', weight: 6, min: 10, max: 25 },
      { id: 'rifle', weight: 1 },
      { id: 'inhaler', weight: 2, min: 1, max: 1 },
    ]),
  }),
});

export function getLootTable(id) {
  const table = LOOT_TABLES[id];
  if (!table) throw new Error(`Unknown loot table "${id}"`);
  return table;
}

export function tableForAnchorKind(kind) {
  return TABLE_BY_ANCHOR_KIND[kind] ?? 'supply';
}

function pickWeighted(entries, random) {
  let total = 0;
  for (const entry of entries) total += entry.weight ?? 1;
  let roll = random.next() * total;
  for (const entry of entries) {
    roll -= entry.weight ?? 1;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/**
 * Roll a table.
 *
 * @param {string} tableId
 * @param {import('../../utils/rng.js').Random} random seeded per anchor
 * @param {(entry:{id:string})=>boolean} [filter] e.g. drop ids that are disabled
 * @returns {Array<{id:string, quantity:number}>} merged drops (never empty
 *          for a table with a `guaranteed` list)
 */
export function rollLootTable(tableId, random, filter = null) {
  const table = getLootTable(tableId);
  const entries = filter ? table.entries.filter((entry) => filter(entry)) : table.entries;
  const drops = [];

  const add = (id, quantity) => {
    const existing = drops.find((drop) => drop.id === id);
    if (existing) existing.quantity += quantity;
    else drops.push({ id, quantity });
  };

  for (const guaranteed of table.guaranteed ?? []) {
    if (filter && !filter(guaranteed)) continue;
    add(guaranteed.id, guaranteed.quantity ?? 1);
  }

  if (entries.length > 0) {
    const [minRolls, maxRolls] = table.rolls ?? [1, 1];
    const rolls = random.int(minRolls, maxRolls);
    for (let i = 0; i < rolls; i += 1) {
      const entry = pickWeighted(entries, random);
      const min = entry.min ?? 1;
      const max = entry.max ?? min;
      add(entry.id, max > min ? random.int(min, max) : min);
    }
  }

  return drops;
}

export function listLootTableIds() {
  return Object.keys(LOOT_TABLES).sort();
}
