import { InputActions } from './InputSystem.js';
import { createElement, isCoarsePointer, removeElement } from '../utils/dom.js';
import { GameEvents } from '../core/events.js';

/**
 * Mobile / tablet controls:
 *  - left half, lower area: floating virtual stick (appears where you touch)
 *  - right half: drag to look
 *  - buttons: fire (hold for automatic), jump (hold), aim (tap to toggle),
 *    sprint (tap to toggle) and reload (tap)
 *  - loot cluster: a contextual pickup/swap button that appears only when
 *    something is in reach, swap/drop weapon, and one quick-use button per
 *    consumable stack (labelled with the item and its remaining count)
 *  - a convert button appears while EP can be turned into HP
 *  - top right: pause
 *
 * Every button writes the same `InputActions` the keyboard does, so the combat
 * and movement code cannot tell which device is in use.
 *
 * The widget only ever calls `input.*` - the exact same API the keyboard uses -
 * so nothing in the simulation layer knows which device is driving it.
 */
const STICK_SOURCE = 'touch';
const STICK_RADIUS = 48; // px, matches the CSS knob travel

export class TouchControls {
  /**
   * @param {object} options
   * @param {HTMLElement} options.uiRoot
   * @param {import('./InputSystem.js').InputSystem} options.input
   * @param {boolean|null} [options.forceVisible] null = automatic (device based)
   */
  constructor({ uiRoot, input, forceVisible = null }) {
    this.name = 'touchControls';
    this.uiRoot = uiRoot;
    this.input = input;
    this.forceVisible = forceVisible;

    this.sprinting = false;
    this.aiming = false;
    this.visible = false;
    this.paused = false;
    /** Contextual loot prompt currently shown (null when nothing is near). */
    this.prompt = null;

    this._stickPointerId = null;
    this._lookPointerId = null;
    this._lookLast = { x: 0, y: 0 };
    this._stickOrigin = { x: 0, y: 0 };

    this.root = this._buildDom();
    uiRoot?.appendChild(this.root);
  }

  // ------------------------------------------------------------------ dom --

  _buildDom() {
    const stickZone = createElement('div', {
      className: 'touch__zone touch__stick-zone',
      attrs: { 'data-role': 'move' },
    });
    const lookZone = createElement('div', {
      className: 'touch__zone touch__look',
      attrs: { 'data-role': 'look' },
    });

    this.knob = createElement('div', { className: 'touch__knob' });
    this.stickBase = createElement('div', { className: 'touch__stick' }, [this.knob]);

    this.jumpButton = createElement('button', {
      className: 'touch__button',
      text: 'Jump',
      attrs: { type: 'button', 'aria-label': 'Jump' },
    });
    this.fireButton = createElement('button', {
      className: 'touch__button touch__button--primary',
      text: 'Fire',
      attrs: { type: 'button', 'aria-label': 'Fire weapon' },
    });
    this.sprintButton = createElement('button', {
      className: 'touch__button touch__button--small',
      text: 'Run',
      attrs: { type: 'button', 'aria-label': 'Toggle sprint' },
    });
    this.aimButton = createElement('button', {
      className: 'touch__button touch__button--small',
      text: 'Aim',
      attrs: { type: 'button', 'aria-label': 'Toggle aim' },
    });
    this.reloadButton = createElement('button', {
      className: 'touch__button touch__button--small',
      text: 'Reload',
      attrs: { type: 'button', 'aria-label': 'Reload weapon' },
    });

    // --- loot cluster -----------------------------------------------------
    this.interactButton = createElement('button', {
      className: 'touch__button touch__button--context touch--hidden',
      text: 'Pick up',
      attrs: { type: 'button', 'aria-label': 'Pick up loot' },
    });
    this.swapButton = createElement('button', {
      className: 'touch__button touch__button--small',
      text: 'Swap',
      attrs: { type: 'button', 'aria-label': 'Swap weapon' },
    });
    this.dropButton = createElement('button', {
      className: 'touch__button touch__button--small',
      text: 'Drop',
      attrs: { type: 'button', 'aria-label': 'Drop weapon' },
    });
    this.convertButton = createElement('button', {
      className: 'touch__button touch__button--small touch__button--convert touch--hidden',
      text: 'EP→HP',
      attrs: { type: 'button', 'aria-label': 'Convert EP into HP' },
    });
    this.itemButtons = [];
    for (let i = 0; i < 2; i += 1) {
      const button = createElement('button', {
        className: 'touch__button touch__button--small touch__button--item touch--hidden',
        text: `Item ${i + 1}`,
        attrs: { type: 'button', 'aria-label': `Use consumable ${i + 1}` },
      });
      this.itemButtons.push(button);
    }

    const lootRow = createElement('div', { className: 'touch__row' }, [
      ...this.itemButtons,
      this.convertButton,
      this.swapButton,
      this.dropButton,
    ]);
    const upperRow = createElement('div', { className: 'touch__row' }, [
      this.reloadButton,
      this.aimButton,
      this.sprintButton,
    ]);
    const lowerRow = createElement('div', { className: 'touch__row' }, [
      this.interactButton,
      this.jumpButton,
      this.fireButton,
    ]);
    const buttons = createElement('div', { className: 'touch__buttons' }, [lootRow, upperRow, lowerRow]);

    this.menuButton = createElement('button', {
      className: 'touch__menu',
      text: '\u23F8',
      attrs: { type: 'button', 'aria-label': 'Pause' },
    });

    const root = createElement('div', { className: 'touch touch--hidden' }, [
      lookZone,
      stickZone,
      this.stickBase,
      buttons,
      this.menuButton,
    ]);

    this.stickZone = stickZone;
    this.lookZone = lookZone;
    return root;
  }

  // ------------------------------------------------------------- lifecycle --

  init(game) {
    this.game = game;

    this.stickZone.addEventListener('pointerdown', (e) => this._onStickDown(e));
    this.stickZone.addEventListener('pointermove', (e) => this._onStickMove(e));
    this.stickZone.addEventListener('pointerup', (e) => this._onStickUp(e));
    this.stickZone.addEventListener('pointercancel', (e) => this._onStickUp(e));

    this.lookZone.addEventListener('pointerdown', (e) => this._onLookDown(e));
    this.lookZone.addEventListener('pointermove', (e) => this._onLookMove(e));
    this.lookZone.addEventListener('pointerup', (e) => this._onLookUp(e));
    this.lookZone.addEventListener('pointercancel', (e) => this._onLookUp(e));

    this._bindHoldButton(this.jumpButton, InputActions.JUMP);
    // Holding fire repeats (automatic weapons); tapping fires a single shot.
    this._bindHoldButton(this.fireButton, InputActions.PRIMARY);
    this._bindTapButton(this.reloadButton, InputActions.RELOAD);
    // Loot actions: one tap each, exactly like their keyboard counterparts.
    this._bindTapButton(this.interactButton, InputActions.INTERACT);
    this._bindTapButton(this.swapButton, InputActions.SWAP_WEAPON);
    this._bindTapButton(this.dropButton, InputActions.DROP_WEAPON);
    this._bindTapButton(this.convertButton, InputActions.CONVERT);
    this.itemButtons.forEach((button, index) => {
      this._bindTapButton(button, InputActions[`USE_ITEM_${index + 1}`]);
    });
    this.sprintButton.addEventListener('pointerdown', (e) => this._onToggle(e, 'sprinting', this.sprintButton, InputActions.SPRINT));
    this.aimButton.addEventListener('pointerdown', (e) => this._onToggle(e, 'aiming', this.aimButton, InputActions.AIM));
    this.menuButton.addEventListener('click', () => this.game.services.get('menu')?.togglePause());

    // Reveal/hide depending on which device is actually used.
    this.input.events.on('controlmode', (mode) => this._syncVisibility(mode));
    this.input.onActionDown(({ action }) => {
      if (action === InputActions.TOGGLE_TOUCH) this.setVisible(!this.visible, { userForced: true });
    });

    this._unsubscribe = [
      game.bus.on('loot:prompt', ({ prompt }) => this._syncPrompt(prompt)),
      game.bus.on('inventory:changed', () => this._syncLoadout()),
      game.bus.on('combat:player:eliminated', () => this._syncPrompt(null)),
    ];
    this._syncLoadout();

    this.setVisible(this.shouldStartVisible());

    // Hidden while the game is paused so the overlay keeps every pointer event.
    game.bus.on(GameEvents.PAUSE, () => {
      this.paused = true;
      this._resetInputs();
      this._applyVisibility();
    });
    game.bus.on(GameEvents.RESUME, () => {
      this.paused = false;
      this._applyVisibility();
    });
  }

  /**
   * Contextual pickup/swap button. It only appears when something is actually in
   * reach, and it says what it will do ("Pick up", "Swap", "Full").
   */
  _syncPrompt(prompt) {
    this.prompt = prompt;
    if (!this.interactButton) return;
    const visible = Boolean(prompt) && prompt.action !== 'full';
    this.interactButton.classList.toggle('touch--hidden', !visible);
    if (!visible) return;
    const label = prompt.action === 'swap' ? 'Swap' : 'Pick up';
    if (this.interactButton.textContent !== label) this.interactButton.textContent = label;
    this.interactButton.title = prompt.name ?? '';
  }

  /** Quick-use buttons mirror the inventory: label + availability. */
  _syncLoadout() {
    const inventory = this.game?.services?.get('inventory');
    if (!inventory) return;
    for (let i = 0; i < this.itemButtons.length; i += 1) {
      const stack = inventory.inventory.consumableAt(i);
      const button = this.itemButtons[i];
      button.classList.toggle('touch--hidden', !stack);
      if (!stack) continue;
      const name = inventory.inventory.lookup(stack.itemId)?.shortName ?? stack.itemId;
      const label = `${name} x${stack.quantity}`;
      if (button.textContent !== label) button.textContent = label;
    }
  }

  /** Per-frame: only the convert affordance changes over time. */
  update() {
    const vitals = this.game?.services?.get('vitals');
    if (!vitals || !this.convertButton) return;
    const available = vitals.converting || vitals.canConvert;
    this.convertButton.classList.toggle('touch--hidden', !available);
    const label = vitals.converting ? 'Stop' : 'EP→HP';
    if (this.convertButton.textContent !== label) this.convertButton.textContent = label;
  }

  /** Device-based default visibility, honouring an explicit override. */
  shouldStartVisible() {
    if (this.forceVisible === true) return true;
    if (this.forceVisible === false) return false;
    return isCoarsePointer() || this.input.controlMode === 'touch';
  }

  _syncVisibility(mode) {
    if (this.forceVisible !== null) return; // the user asked for a fixed mode
    this.setVisible(mode === 'touch');
  }

  setVisible(visible, { userForced = false } = {}) {
    if (userForced) this.forceVisible = visible;
    this.visible = visible;
    this._applyVisibility();
    this.input.events.emit('touchvisibility', visible);
    if (!visible) this._resetInputs();
  }

  _applyVisibility() {
    const shown = this.visible && !this.paused;
    this.root.classList.toggle('touch--hidden', !shown);
    // Lets CSS adapt (cursor, hidden HUD hints, ...) without querying JS.
    if (typeof document !== 'undefined') document.body.dataset.touch = String(shown);
  }

  // ------------------------------------------------------------- handlers --

  _onStickDown(event) {
    if (event.pointerType === 'mouse' && !this.visible) return;
    event.preventDefault();
    this._stickPointerId = event.pointerId;
    this.stickZone.setPointerCapture(event.pointerId);

    // Floating stick: the base is placed wherever the thumb lands.
    const rect = this.stickZone.getBoundingClientRect();
    this._stickOrigin.x = event.clientX;
    this._stickOrigin.y = event.clientY;
    this.stickBase.style.left = `${event.clientX - rect.left}px`;
    this.stickBase.style.top = `${event.clientY - rect.top}px`;
    this.stickBase.style.bottom = 'auto';
    this._setKnob(0, 0);
  }

  _onStickMove(event) {
    if (event.pointerId !== this._stickPointerId) return;
    event.preventDefault();

    let dx = event.clientX - this._stickOrigin.x;
    let dy = event.clientY - this._stickOrigin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS) {
      dx = (dx / distance) * STICK_RADIUS;
      dy = (dy / distance) * STICK_RADIUS;
    }

    this._setKnob(dx, dy);
    this.input.setMove(STICK_SOURCE, dx / STICK_RADIUS, -dy / STICK_RADIUS);
  }

  _onStickUp(event) {
    if (event.pointerId !== this._stickPointerId) return;
    this._stickPointerId = null;
    this.input.setMove(STICK_SOURCE, 0, 0);
    this._setKnob(0, 0);
  }

  _setKnob(x, y) {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  _onLookDown(event) {
    if (this._lookPointerId !== null) return;
    event.preventDefault();
    this._lookPointerId = event.pointerId;
    this._lookLast.x = event.clientX;
    this._lookLast.y = event.clientY;
    this.lookZone.setPointerCapture(event.pointerId);
  }

  _onLookMove(event) {
    if (event.pointerId !== this._lookPointerId) return;
    const dx = event.clientX - this._lookLast.x;
    const dy = event.clientY - this._lookLast.y;
    this._lookLast.x = event.clientX;
    this._lookLast.y = event.clientY;
    this.input.addLook(STICK_SOURCE, dx, dy);
  }

  _onLookUp(event) {
    if (event.pointerId !== this._lookPointerId) return;
    this._lookPointerId = null;
  }

  _bindHoldButton(element, action) {
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      element.classList.add('touch__button--active');
      this.input.press(STICK_SOURCE, action);
    });
    const release = () => {
      element.classList.remove('touch__button--active');
      this.input.release(STICK_SOURCE, action);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
  }

  /** Momentary press: fires the action edge, then releases it. */
  _bindTapButton(element, action) {
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.classList.add('touch__button--active');
      this.input.press(STICK_SOURCE, action);
      this.input.release(STICK_SOURCE, action);
      setTimeout(() => element.classList.remove('touch__button--active'), 120);
    });
  }

  /** Latching button: flips a boolean flag and a held action with it. */
  _onToggle(event, flag, element, action) {
    event.preventDefault();
    this[flag] = !this[flag];
    element.classList.toggle('touch__button--active', this[flag]);
    if (this[flag]) this.input.press(STICK_SOURCE, action);
    else this.input.release(STICK_SOURCE, action);
  }

  /** Drop every piece of state this widget owns. */
  _resetInputs() {
    this._stickPointerId = null;
    this._lookPointerId = null;
    this.sprinting = false;
    this.aiming = false;
    for (const button of [this.sprintButton, this.jumpButton, this.aimButton, this.fireButton]) {
      button?.classList.remove('touch__button--active');
    }
    this._setKnob(0, 0);
    this.input.setMove(STICK_SOURCE, 0, 0);
    this.input.release(STICK_SOURCE, InputActions.JUMP);
    this.input.release(STICK_SOURCE, InputActions.SPRINT);
    this.input.release(STICK_SOURCE, InputActions.PRIMARY);
    this.input.release(STICK_SOURCE, InputActions.AIM);
    this._syncPrompt(null);
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
    this._resetInputs();
    removeElement(this.root);
  }
}
