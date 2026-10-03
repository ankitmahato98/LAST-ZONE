/**
 * Loot item definitions - the data half of the loot system.
 *
 * Every pickup in the world is described by one of these entries; the systems
 * (`LootSystem`, `Inventory`, `ConsumableUse`) only ever read fields, they never
 * special case an item name. Adding a new consumable, ammo type or (later) an
 * armor plate is a data change plus a `tint`/`visual` if it should look
 * different in the world.
 *
 * Conventions:
 *   - `kind`   what the item *is* (drives which inventory container accepts it)
 *   - `stackSize` the hard cap for one stack / ammo pool
 *   - `pickup` { min, max } the quantity range a single world spawn rolls
 *   - `use`    only on consumables; the whole consumption flow lives here so the
 *              numbers can be rebalanced without touching a system
 *   - `visual` which instanced world model represents it
 *
 * BALANCE NOTE (Phase B, locked values): the player has 200 max HP and 300 max
 * EP, EP never regenerates passively and 1 EP converts into 1 HP. Item values
 * below are deliberately *partial* restores so a single item can never be an
 * unlimited heal.
 */

export const ItemKind = Object.freeze({
  WEAPON: 'weapon',
  AMMO: 'ammo',
  CONSUMABLE: 'consumable',
  /** Wired for future phases - stored, not yet spawned. */
  ARMOR: 'armor',
  ATTACHMENT: 'attachment',
  COSMETIC: 'cosmetic',
});

export const ConsumableCategory = Object.freeze({
  /** Restores HP (may also restore EP). */
  HEAL: 'heal',
  /** Restores EP only - never HP directly. */
  ENERGY: 'energy',
});

/**
 * How a consumable applies its effect:
 *   - `instant`  the whole restore lands when the channel completes
 *   - `gradual`  the restore is spread evenly over the channel duration
 */
export const ConsumableApplication = Object.freeze({
  INSTANT: 'instant',
  GRADUAL: 'gradual',
});

/** Ammo families. A weapon references one through `type.ammoType`. */
export const AMMO_TYPES = Object.freeze({
  556: Object.freeze({ id: '556', name: '5.56mm', maxCarry: 300 }),
});

function item(definition) {
  return Object.freeze({ enabled: true, ...definition });
}

export const ITEMS = Object.freeze({
  // ------------------------------------------------------------- ammunition --
  'ammo-556': item({
    id: 'ammo-556',
    name: '5.56mm Ammo',
    shortName: '5.56mm',
    kind: ItemKind.AMMO,
    ammoType: '556',
    /** Also the ammo pool cap for this type. */
    stackSize: 300,
    pickup: { min: 20, max: 45 },
    visual: 'ammo-box',
    tint: 0xd8a13c,
    description: 'Rifle rounds. Any 5.56mm weapon in the loadout draws from this pool.',
  }),

  // ------------------------------------------------------------ consumables --
  mushroom: item({
    id: 'mushroom',
    name: 'Mushroom',
    shortName: 'Mushroom',
    kind: ItemKind.CONSUMABLE,
    category: ConsumableCategory.ENERGY,
    stackSize: 5,
    pickup: { min: 1, max: 2 },
    visual: 'mushroom',
    tint: 0xc9553f,
    /**
     * EP only. `Vitals.addEnergy` clamps at the EP maximum (300), and because
     * conversion is capped by max HP the mushroom can never become free HP.
     */
    use: {
      duration: 1.1,
      application: ConsumableApplication.INSTANT,
      health: 0,
      energy: 40,
      interruptOn: ['damage'],
    },
    description: 'Eat for 40 EP. Takes a moment and is lost if you take a hit.',
  }),
  inhaler: item({
    id: 'inhaler',
    name: 'Inhaler',
    shortName: 'Inhaler',
    kind: ItemKind.CONSUMABLE,
    category: ConsumableCategory.HEAL,
    stackSize: 3,
    pickup: { min: 1, max: 1 },
    visual: 'inhaler',
    tint: 0x5fd0e6,
    /**
     * A short channel that restores HP and EP *gradually*. Both are clamped at
     * their maxima, and firing / taking damage / jumping cancels the rest.
     */
    use: {
      duration: 3.2,
      application: ConsumableApplication.GRADUAL,
      health: 60,
      energy: 45,
      interruptOn: ['damage', 'fire', 'jump'],
    },
    description: 'Restores 60 HP and 45 EP over 3.2s. Interrupted by damage or firing.',
  }),

  // ------------------------------------------------- future phase extension --
  // These exist so the inventory, loot tables and HUD are already generic. They
  // are `enabled: false` and appear in no loot table yet.
  'armor-plate-lvl1': item({
    id: 'armor-plate-lvl1',
    name: 'Level 1 Armor Plate',
    kind: ItemKind.ARMOR,
    enabled: false,
    stackSize: 3,
    pickup: { min: 1, max: 1 },
    visual: 'armor-plate',
    tint: 0x8fa4b0,
    description: 'Future: reduces incoming body damage.',
  }),
  'attachment-extended-mag': item({
    id: 'attachment-extended-mag',
    name: 'Extended Magazine',
    kind: ItemKind.ATTACHMENT,
    enabled: false,
    stackSize: 4,
    pickup: { min: 1, max: 1 },
    visual: 'attachment',
    tint: 0x7fd8b0,
    description: 'Future: weapon attachment slot.',
  }),
  'cosmetic-emblem': item({
    id: 'cosmetic-emblem',
    name: 'Emblem',
    kind: ItemKind.COSMETIC,
    enabled: false,
    stackSize: 1,
    pickup: { min: 1, max: 1 },
    visual: 'cosmetic',
    tint: 0xc9a2ff,
    description: 'Future: cosmetic drop.',
  }),
});

/** Every item kind the inventory knows how to store. */
export const ITEM_KINDS = Object.freeze(Object.values(ItemKind));
