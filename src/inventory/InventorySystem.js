import { Inventory } from './Inventory.js';
import { ConsumableUse } from '../combat/ConsumableUse.js';
import { INVENTORY, LOOT, WORLD } from '../config/settings.js';
import { createWeapon } from '../combat/weapons/WeaponTypes.js';
import { lookupItem } from '../loot/items/ItemRegistry.js';
import { ItemKind } from '../loot/items/ItemData.js';

/**
 * Loadout + interaction glue.
 *
 * This is the one place where *player intent* meets *the world*:
 *
 *   intent (E / touch button)  ->  LootSystem pickup  ->  Inventory
 *   Inventory weapons          ->  CombatSystem.equipWeapon()
 *   Inventory ammo pool        ->  the equipped weapon's reserve
 *   consumables               ->  ConsumableUse channel -> Vitals (HP/EP)
 *   EP conversion toggle      ->  Vitals
 *
 * It is deliberately thin: the inventory is pure data, the loot system owns the
 * world entities and combat owns the shooting. This system only routes between
 * them and publishes events the HUD listens to.
 *
 * Events: `loot:prompt`, `inventory:changed`, `inventory:full`,
 * `consumable:start`, `consumable:end`, `consumable:cancel`, `weapon:swap`.
 */
export class InventorySystem {
  constructor({
    config = INVENTORY,
    lootConfig = LOOT,
    seed = WORLD.seed,
    inventory = null,
    use = null,
    weaponFactory = createWeapon,
  } = {}) {
    this.name = 'inventory';
    this.config = config;
    this.lootConfig = lootConfig;
    this.seed = seed;
    this.weaponFactory = weaponFactory;
    this.inventory = inventory ?? new Inventory({ config });
    this.use = use ?? new ConsumableUse();

    /** Nearest pickup within interaction range, kept in sync by LootSystem. */
    this.nearby = null;
    this.nearbyDescription = null;
    /** Prompt shown by the HUD: `{ name, detail, action, key }`. */
    this.prompt = null;
    /** Last rejected action, for HUD feedback ("inventory full"). */
    this.lastRefusal = null;
    this.refusalTimer = 0;
  }

  async init(game) {
    this.game = game;
    this.bus = game.bus;
    this.input = game.services.get('input');
    this.player = game.services.get('player');
    this.loot = game.services.get('loot');
    this.vitals = game.services.get('vitals');
    // Combat is constructed after this system in the engine wiring, so it is
    // resolved lazily on first use rather than during init.
    this.combat = game.services.get('combat') ?? null;

    this._unsubscribe = [
      this.inventory.on('changed', (payload) => this.bus.emit('inventory:changed', payload)),
      this.bus.on('loot:nearby', ({ pickup, description }) => {
        this.nearby = pickup;
        this.nearbyDescription = description;
        this._refreshPrompt();
      }),
      this.bus.on('weapon:reload:end', ({ transfer, weapon }) => this._onReloadEnd(transfer, weapon)),
      this.bus.on('combat:player:hurt', () => this.use.interrupt('damage')),
      this.bus.on('weapon:fired', () => this.use.interrupt('fire')),
      this.bus.on('player:jump', () => this.use.interrupt('jump')),
      this.bus.on('combat:player:eliminated', () => this._onEliminated()),
      this.use.on('complete', ({ itemId }) => this.bus.emit('consumable:end', { itemId, reason: 'complete' })),
      this.use.on('cancel', ({ itemId, reason }) =>
        this.bus.emit('consumable:cancel', { itemId, reason })),
    ];
  }

  get isEliminated() {
    return Boolean(this.combat?.isEliminated);
  }

  get equippedWeapon() {
    return this.inventory.equippedWeapon;
  }

  get using() {
    return this.use.isActive;
  }

  get useProgress() {
    return this.use.progress;
  }

  get usingItemId() {
    return this.use.itemId;
  }

  // ------------------------------------------------------------ simulation --

  fixedUpdate(dt) {
    this._combat(); // resolve once the engine has finished wiring
    this._syncAmmo();
    this._tickRefusal(dt);
    this._updateUse(dt);

    if (this.isEliminated) return;
    const intent = this.input?.intent;
    if (!intent) return;

    if (intent.interactPressed) this.interact();
    if (intent.swapPressed) this.swapWeapon();
    if (intent.dropPressed) this.dropEquipped();
    if (intent.convertPressed) this.toggleConversion();

    const usePressed = intent.useItemPressed;
    if (usePressed) {
      for (let i = 0; i < usePressed.length; i += 1) {
        if (usePressed[i]) this.useConsumableSlot(i);
      }
    }
  }

  _combat() {
    if (!this.combat) this.combat = this.game?.services?.get('combat') ?? null;
    if (!this.vitals) this.vitals = this.game?.services?.get('vitals') ?? null;
    return this.combat;
  }

  // ------------------------------------------------------------ interaction --

  /** Pick up whatever is under the prompt, or refuse with a reason. */
  interact() {
    const pickup = this.nearby ?? this._resolveNearby();
    if (!pickup) {
      this._refuse('nothing-nearby', 'Nothing to pick up');
      return { picked: false, reason: 'nothing-nearby' };
    }

    if (pickup.kind === ItemKind.WEAPON) return this._pickUpWeapon(pickup);
    if (pickup.kind === ItemKind.AMMO) return this._pickUpAmmo(pickup);
    if (pickup.kind === ItemKind.CONSUMABLE) return this._pickUpConsumable(pickup);

    // Armor / attachments / cosmetics: generic container path.
    const result = this.inventory.addFutureItem(pickup.lootId, pickup.quantity);
    if (!result.added) {
      this._refuse('inventory-full', 'No room');
      return { picked: false, reason: result.reason ?? 'inventory-full' };
    }
    this.loot?.takePickup(pickup);
    return { picked: true, kind: pickup.kind, lootId: pickup.lootId };
  }

  _resolveNearby() {
    const position = this.player?.position;
    if (!position || !this.loot) return null;
    this.nearby = this.loot.nearestPickup(position, this.lootConfig.interactionRadius);
    this.nearbyDescription = this.loot.describe(this.nearby);
    return this.nearby;
  }

  _pickUpAmmo(pickup) {
    const definition = lookupItem(pickup.itemId);
    const ammoType = definition?.ammoType ?? '556';
    const added = this.inventory.addAmmo(ammoType, pickup.quantity);
    if (added <= 0) {
      this._refuse('ammo-full', `${definition?.name ?? 'Ammo'} full`);
      return { picked: false, reason: 'ammo-full' };
    }
    this.loot.takePickup(pickup);
    this._syncAmmo();
    this.bus.emit('loot:pickup', { pickup, kind: ItemKind.AMMO, ammoType, amount: added });
    return { picked: true, kind: ItemKind.AMMO, ammoType, amount: added, partial: added < pickup.quantity };
  }

  _pickUpConsumable(pickup) {
    const { added } = this.inventory.addConsumable(pickup.itemId, pickup.quantity);
    if (added <= 0) {
      this._refuse('inventory-full', 'Consumables full');
      return { picked: false, reason: 'inventory-full' };
    }
    if (added >= pickup.quantity) this.loot.takePickup(pickup);
    else pickup.quantity -= added;
    this.bus.emit('loot:pickup', { pickup, kind: ItemKind.CONSUMABLE, itemId: pickup.itemId, amount: added });
    return { picked: true, kind: ItemKind.CONSUMABLE, itemId: pickup.itemId, amount: added };
  }

  /**
   * Weapon pickup. Into an empty slot when there is one, otherwise the pickup
   * swaps with what is in hand: the equipped weapon is dropped into the world
   * (with its remaining magazine) right where the player stands.
   */
  _pickUpWeapon(pickup) {
    const weapon = this.weaponFactory(
      pickup.weaponId,
      {},
      { magazine: pickup.state?.magazine ?? null, reserve: 0 },
    );

    const free = this.inventory.findFreeWeaponSlot();
    let dropped = null;
    let slot;
    if (free >= 0) {
      slot = free;
      this.inventory.addWeapon(weapon, { slot });
    } else {
      slot = this.inventory.equippedSlot;
      const current = this.inventory.setWeapon(slot, weapon);
      if (current) dropped = this._drop(current, { position: pickup.position, yaw: current.yaw });
    }

    this.loot.takePickup(pickup);
    this._equipSlot(slot);
    this.bus.emit('loot:pickup', { pickup, kind: ItemKind.WEAPON, weaponId: pickup.weaponId, dropped: dropped?.id ?? null });
    return { picked: true, kind: ItemKind.WEAPON, weaponId: pickup.weaponId, dropped };
  }

  /** Put a weapon into the world as a real, pickable entity. */
  _drop(weapon, { position = null, yaw = null } = {}) {
    if (!this.loot || !weapon) return null;
    const at = position ?? this.player.position;
    const heading = yaw ?? this.player.yaw ?? 0;
    return this.loot.dropAtFeet(weapon.id, at, heading, 1, { magazine: weapon.magazine });
  }

  // ---------------------------------------------------------------- loadout --

  swapWeapon() {
    const previous = this.inventory.equippedSlot;
    const slot = this.inventory.swapWeapon();
    if (slot === previous) return { swapped: false };
    this._equipSlot(slot);
    return { swapped: true, slot };
  }

  dropEquipped() {
    const weapon = this.inventory.removeWeapon(this.inventory.equippedSlot);
    if (!weapon) return { dropped: false, reason: 'no-weapon' };
    const pickup = this._drop(weapon);
    this._equipSlot(this.inventory.equippedSlot);
    this.bus.emit('weapon:drop', { weapon: weapon.id, pickup: pickup?.id ?? null });
    return { dropped: true, weapon: weapon.id };
  }

  _equipSlot(slot) {
    // Emptying the active slot (a drop) falls back to whatever is still carried.
    if (!this.inventory.weapons[slot]) {
      const fallback = this.inventory.weapons.findIndex(Boolean);
      if (fallback >= 0) slot = fallback;
    }
    const weapon = this.inventory.weapons[slot];
    this.inventory.equip(slot);
    const combat = this._combat();
    if (!combat) return;
    if (weapon) combat.equipWeapon(weapon);
    else combat.unequipWeapon();
    this._syncAmmo();
    this.bus.emit('weapon:swap', { slot, weapon: weapon?.id ?? null });
    this._refreshPrompt();
  }

  /**
   * Reserve ammo lives in the inventory, not on the weapon: the mirror keeps
   * `weapon.reserve` (and therefore the existing reload math and HUD) honest.
   */
  _syncAmmo() {
    const weapon = this.inventory.equippedWeapon;
    if (!weapon) return;
    const pool = this.inventory.ammoCount(weapon.ammoType);
    if (weapon.reserve !== pool) weapon.reserve = pool;
  }

  _onReloadEnd(transfer = 0, weaponId = null) {
    const weapon = this.inventory.equippedWeapon;
    if (!weapon || (weaponId && weapon.id !== weaponId) || !(transfer > 0)) return;
    this.inventory.removeAmmo(weapon.ammoType, transfer);
  }

  // ------------------------------------------------------------ consumables --

  /**
   * Begin using the consumable in quick-slot `index`.
   * The item leaves the inventory immediately; an interrupted channel keeps
   * only the effect it already applied.
   */
  useConsumableSlot(index) {
    if (this.isEliminated) return { started: false, reason: 'eliminated' };
    if (this.use.isActive) return { started: false, reason: 'busy' };

    const stack = this.inventory.consumableAt(index);
    if (!stack) return { started: false, reason: 'empty' };

    const definition = lookupItem(stack.itemId);
    if (!definition?.use) return { started: false, reason: 'not-consumable' };

    const removed = this.inventory.removeConsumable(stack.itemId, 1);
    if (removed <= 0) return { started: false, reason: 'empty' };

    const result = this.use.start(definition);
    if (!result.started) {
      // Put it back rather than eating the item for nothing.
      this.inventory.addConsumable(stack.itemId, 1);
      return result;
    }
    this.bus.emit('consumable:start', {
      itemId: definition.id,
      name: definition.name,
      duration: this.use.duration,
    });
    return { started: true, itemId: definition.id, duration: this.use.duration };
  }

  /** Convenience for tests/HUD: use the first stack of a given item id. */
  useConsumable(itemId) {
    const index = this.inventory.consumableIndex(itemId);
    if (index < 0) return { started: false, reason: 'empty' };
    return this.useConsumableSlot(index);
  }

  _updateUse(dt) {
    if (!this.use.isActive) return;
    const effects = this.use.update(dt);
    if (!effects) return;
    if (effects.health > 0) this.vitals?.heal(effects.health);
    if (effects.energy > 0) this.vitals?.addEnergy(effects.energy);
  }

  // ------------------------------------------------------------- conversion --

  toggleConversion() {
    const vitals = this.vitals ?? this.game?.services?.get('vitals');
    if (!vitals) return false;
    const started = vitals.toggleConversion();
    this.bus.emit('vitals:conversion:toggle', { converting: vitals.converting });
    return started;
  }

  // ------------------------------------------------------------------- misc --

  _refreshPrompt() {
    const pickup = this.nearby;
    if (!pickup) {
      if (this.prompt) {
        this.prompt = null;
        this.bus.emit('loot:prompt', { prompt: null });
      }
      return;
    }
    const description = this.nearbyDescription ?? this.loot?.describe(pickup);
    const weaponSwap = pickup.kind === ItemKind.WEAPON && !this.inventory.hasFreeWeaponSlot();
    const full = pickup.kind === ItemKind.CONSUMABLE
      && this.inventory.consumableCount(pickup.itemId) >= this.inventory.stackLimit(pickup.itemId);
    const next = {
      id: pickup.id,
      lootId: pickup.lootId,
      kind: pickup.kind,
      name: description?.name ?? pickup.lootId,
      detail: description?.detail ?? '',
      action: weaponSwap ? 'swap' : full ? 'full' : 'pickup',
      label: weaponSwap ? 'SWAP' : full ? 'FULL' : 'PICK UP',
    };
    const changed = !this.prompt
      || this.prompt.id !== next.id
      || this.prompt.action !== next.action
      || this.prompt.name !== next.name;
    this.prompt = next;
    if (changed) this.bus.emit('loot:prompt', { prompt: next });
  }

  _refuse(reason, message) {
    this.lastRefusal = { reason, message };
    this.refusalTimer = this.config.refusalTime;
    this.bus.emit('inventory:full', { reason, message });
    this.bus.emit('inventory:refused', { reason, message });
  }

  _tickRefusal(dt) {
    if (this.refusalTimer <= 0) return;
    this.refusalTimer = Math.max(0, this.refusalTimer - dt);
    if (this.refusalTimer === 0) this.lastRefusal = null;
  }

  _onEliminated() {
    this.use.cancel('eliminated');
    this.prompt = null;
    this.nearby = null;
    this.bus.emit('loot:prompt', { prompt: null });
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
    this.inventory.events.clear();
    this.use.events.clear();
  }
}
