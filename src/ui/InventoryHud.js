import { createElement, removeElement } from '../utils/dom.js';
import { clamp } from '../utils/math.js';
import { INVENTORY } from '../config/settings.js';

/**
 * Loadout HUD: vitals (HP/EP), weapon slots, consumables, the contextual pickup
 * prompt and the consumption/ conversion progress readouts.
 *
 * Pure observer, exactly like `CombatHud`: it reads services and listens to bus
 * events, and never writes gameplay state. The DOM is only touched when a value
 * actually changes, so a 60 fps loop costs nothing.
 *
 * Layout (all mobile safe-area aware):
 *   bottom left   HP bar 200 / EP bar 300, conversion state
 *   bottom right   weapon slot list + consumable quick slots (keys 1..4)
 *   centre        pickup prompt + channel progress (using an item / converting)
 */
export class InventoryHud {
  constructor({ uiRoot, config = INVENTORY } = {}) {
    this.name = 'inventoryHud';
    this.uiRoot = uiRoot;
    this.config = config;
    this.prompt = null;
  }

  init(game) {
    this.game = game;
    this.inventory = game.services.get('inventory');
    this.combat = game.services.get('combat');
    this.vitals = game.services.get('vitals');
    this.loot = game.services.get('loot');
    this._textCache = new Map();

    this.root = this._buildDom();
    this.uiRoot.appendChild(this.root);

    this._unsubscribe = [
      game.bus.on('loot:prompt', ({ prompt }) => this.setPrompt(prompt)),
      game.bus.on('consumable:start', ({ name, duration }) => this._setUsing(name, duration)),
      game.bus.on('consumable:end', () => this._clearUsing()),
      game.bus.on('consumable:cancel', ({ reason }) => this._clearUsing(reason)),
      game.bus.on('inventory:full', ({ message }) => this._flashRefusal(message)),
      game.bus.on('combat:player:eliminated', () => this._onEliminated()),
      game.bus.on('inventory:changed', () => this._refreshLoadout()),
    ];

    this._refreshLoadout();
    this._clearUsing();
  }

  // ------------------------------------------------------------------- dom --

  _buildDom() {
    // --- vitals (bottom left, replaces the Phase A single health bar) ------
    this.healthValue = createElement('span', { className: 'vitals__value', text: '200' });
    this.healthFill = createElement('div', { className: 'vitals__fill' });
    this.energyValue = createElement('span', { className: 'vitals__value vitals__value--ep', text: '0 / 300' });
    this.energyFill = createElement('div', { className: 'vitals__fill vitals__fill--ep' });
    this.conversionState = createElement('div', {
      className: 'vitals__conversion',
      text: 'EP 1:1 HP · 1/s',
    });

    this.vitalsBlock = createElement('div', { className: 'vitals' }, [
      createElement('div', { className: 'vitals__row' }, [
        createElement('span', { className: 'vitals__label', text: '\u2764\ufe0f HP' }),
        this.healthValue,
      ]),
      createElement('div', { className: 'vitals__bar' }, [this.healthFill]),
      createElement('div', { className: 'vitals__row vitals__row--ep' }, [
        createElement('span', { className: 'vitals__label', text: '\u26a1 EP' }),
        this.energyValue,
      ]),
      createElement('div', { className: 'vitals__bar' }, [this.energyFill]),
      this.conversionState,
    ]);

    // --- loadout (bottom right, next to the ammo block) --------------------
    this.weaponSlots = [
      createElement('div', { className: 'loadout__slot', text: '1  —' }),
      createElement('div', { className: 'loadout__slot', text: '2  —' }),
    ];
    this.consumableSlots = [];
    for (let i = 0; i < this.config.consumableSlots; i += 1) {
      const row = createElement('div', {
        className: 'loadout__item loadout__item--empty',
        text: `${i + 1}  —`,
      });
      this.consumableSlots.push(row);
    }
    this.loadout = createElement('div', { className: 'loadout' }, [
      createElement('div', { className: 'loadout__title', text: 'Loadout' }),
      ...this.weaponSlots,
      createElement('div', { className: 'loadout__divider' }),
      ...this.consumableSlots,
    ]);

    // --- centre prompt + channel progress ---------------------------------
    this.promptLabel = createElement('span', { className: 'prompt__action', text: 'PICK UP' });
    this.promptKey = createElement('kbd', { className: 'prompt__key', text: 'E' });
    this.promptName = createElement('div', { className: 'prompt__name', text: '' });
    this.promptDetail = createElement('div', { className: 'prompt__detail', text: '' });
    this.prompt = createElement('div', { className: 'prompt prompt--hidden' }, [
      createElement('div', { className: 'prompt__row' }, [
        this.promptKey,
        this.promptLabel,
        this.promptName,
      ]),
      this.promptDetail,
    ]);

    this.useFill = createElement('div', { className: 'channel__fill' });
    this.useLabel = createElement('span', { className: 'channel__label', text: 'USING' });
    this.channel = createElement('div', { className: 'channel channel--hidden' }, [
      this.useLabel,
      createElement('div', { className: 'channel__track' }, [this.useFill]),
    ]);

    this.refusal = createElement('div', { className: 'refusal refusal--hidden', text: '' });

    return createElement('div', { className: 'inventory-hud' }, [
      this.vitalsBlock,
      this.loadout,
      this.prompt,
      this.channel,
      this.refusal,
    ]);
  }

  // ---------------------------------------------------------------- prompt --

  /** @param {{name:string, detail:string, action:string, label:string}|null} prompt */
  setPrompt(prompt) {
    this.promptData = prompt;
    if (!prompt) {
      this.prompt.classList.add('prompt--hidden');
      return;
    }
    this.prompt.classList.remove('prompt--hidden');
    this.prompt.classList.toggle('prompt--swap', prompt.action === 'swap');
    this.prompt.classList.toggle('prompt--full', prompt.action === 'full');
    this._setText(this.promptName, prompt.name);
    this._setText(this.promptLabel, prompt.label);
    this._setText(this.promptDetail, prompt.detail ?? '');
  }

  _setUsing(name, duration) {
    this.channel.classList.remove('channel--hidden');
    this._setText(this.useLabel, `USING ${String(name).toUpperCase()}`);
    this._setStyle(this.useFill, 'transform', 'scaleX(0)');
    this._usingName = name;
    this._usingDuration = duration;
  }

  _clearUsing(reason = null) {
    this.channel.classList.add('channel--hidden');
    this._setStyle(this.useFill, 'transform', 'scaleX(0)');
    this._usingName = null;
    if (reason && reason !== 'eliminated') this._flashRefusal(`Interrupted (${reason})`);
  }

  _flashRefusal(message) {
    if (!message) return;
    this._setText(this.refusal, message);
    this.refusal.classList.remove('refusal--hidden');
    this.refusalTimer = 1.4;
  }

  _onEliminated() {
    this.setPrompt(null);
    this.channel.classList.add('channel--hidden');
    this._setClass(this.root, 'inventory-hud--dead', true);
  }

  // --------------------------------------------------------------- loadout --

  _refreshLoadout() {
    const inventory = this.inventory?.inventory;
    if (!inventory) return;

    for (let i = 0; i < this.weaponSlots.length; i += 1) {
      const weapon = inventory.weapons[i];
      const equipped = inventory.equippedSlot === i;
      this._setText(this.weaponSlots[i], `${i + 1}  ${weapon ? weapon.name : '—'}`);
      this._setClass(this.weaponSlots[i], 'loadout__slot--active', equipped && Boolean(weapon));
      this._setClass(this.weaponSlots[i], 'loadout__slot--empty', !weapon);
    }

    for (let i = 0; i < this.consumableSlots.length; i += 1) {
      const stack = inventory.consumableAt(i);
      const node = this.consumableSlots[i];
      if (!stack) {
        this._setText(node, `${i + 1}  —`);
        this._setClass(node, 'loadout__item--empty', true);
        continue;
      }
      const definition = inventory.lookup(stack.itemId);
      this._setText(node, `${i + 1}  ${definition?.shortName ?? stack.itemId} x${stack.quantity}`);
      this._setClass(node, 'loadout__item--empty', false);
    }
  }

  // --------------------------------------------------------------- updates --

  update(dt) {
    const vitals = this.vitals ?? this.combat?.vitals;
    if (vitals) {
      const hp = Math.round(vitals.hp);
      this._setText(this.healthValue, `${hp} / ${vitals.maxHp}`);
      this._setStyle(this.healthFill, 'transform', `scaleX(${vitals.hpFraction.toFixed(3)})`);
      this._setStyle(
        this.healthFill,
        'background',
        vitals.hpFraction > 0.55 ? 'linear-gradient(90deg,#4ef0c8,#7ff5d8)'
          : vitals.hpFraction > 0.25 ? 'linear-gradient(90deg,#ffc95c,#ffe0a0)'
            : 'linear-gradient(90deg,#ff5f5f,#ff9a8a)',
      );
      this._setClass(this.vitalsBlock, 'vitals--critical', vitals.hpFraction <= 0.25);

      this._setText(this.energyValue, `${Math.floor(vitals.energy)} / ${vitals.maxEnergy}`);
      this._setStyle(this.energyFill, 'transform', `scaleX(${vitals.energyFraction.toFixed(3)})`);
      this._setText(
        this.conversionState,
        vitals.converting
          ? 'CONVERTING · 1 EP/s \u2192 1 HP/s'
          : vitals.canConvert
            ? '[C] CONVERT EP \u2192 HP'
            : 'EP 1:1 HP · 1/s',
      );
      this._setClass(this.vitalsBlock, 'vitals--converting', vitals.converting);
    }

    const use = this.inventory?.use;
    if (use?.isActive) {
      this._setStyle(this.useFill, 'transform', `scaleX(${clamp(use.progress, 0, 1).toFixed(3)})`);
    }

    if (this.refusalTimer > 0) {
      this.refusalTimer = Math.max(0, this.refusalTimer - dt);
      if (this.refusalTimer === 0) this.refusal.classList.add('refusal--hidden');
    }
  }

  // ------------------------------------------------------- change detection --

  _setText(node, value) {
    if (!node) return;
    const key = node.dataset.cacheKey ?? (node.dataset.cacheKey = String(this._textCache.size));
    if (this._textCache.get(key) === value) return;
    this._textCache.set(key, value);
    node.textContent = value;
  }

  _setStyle(node, property, value) {
    if (!node || node.style.getPropertyValue(property) === value) return;
    node.style.setProperty(property, value);
  }

  _setClass(node, className, active) {
    if (!node) return;
    node.classList.toggle(className, Boolean(active));
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    removeElement(this.root);
    this.root = null;
  }
}
