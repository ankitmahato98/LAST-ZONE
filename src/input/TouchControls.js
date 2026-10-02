import { InputActions } from './InputSystem.js';
import { createElement, isCoarsePointer, removeElement } from '../utils/dom.js';
import { GameEvents } from '../core/events.js';

/**
 * Mobile / tablet controls:
 *  - left half, lower area: floating virtual stick (appears where you touch)
 *  - right half: drag to look
 *  - buttons: jump (hold) and sprint (tap to toggle, like most mobile BRs)
 *  - top right: pause
 *
 * The widget only ever calls `input.*` - the exact same API the keyboard uses -
 * so nothing in the simulation layer knows which device is driving it.
 */
const STICK_SOURCE = 'touch';
const STICK_RADIUS = 62; // px, matches the CSS knob travel

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
    this.visible = false;
    this.paused = false;

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
      className: 'touch__button touch__button--primary',
      text: 'Jump',
      attrs: { type: 'button', 'aria-label': 'Jump' },
    });
    this.sprintButton = createElement('button', {
      className: 'touch__button',
      text: 'Run',
      attrs: { type: 'button', 'aria-label': 'Toggle sprint' },
    });
    const buttons = createElement('div', { className: 'touch__buttons' }, [
      this.sprintButton,
      this.jumpButton,
    ]);

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
    this.sprintButton.addEventListener('pointerdown', (e) => this._onSprintTap(e));
    this.menuButton.addEventListener('click', () => this.game.services.get('menu')?.togglePause());

    // Reveal/hide depending on which device is actually used.
    this.input.events.on('controlmode', (mode) => this._syncVisibility(mode));
    this.input.onActionDown(({ action }) => {
      if (action === InputActions.TOGGLE_TOUCH) this.setVisible(!this.visible, { userForced: true });
    });

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

  _onSprintTap(event) {
    event.preventDefault();
    this.sprinting = !this.sprinting;
    this.sprintButton.classList.toggle('touch__button--active', this.sprinting);
    if (this.sprinting) this.input.press(STICK_SOURCE, InputActions.SPRINT);
    else this.input.release(STICK_SOURCE, InputActions.SPRINT);
  }

  /** Drop every piece of state this widget owns. */
  _resetInputs() {
    this._stickPointerId = null;
    this._lookPointerId = null;
    this.sprinting = false;
    this.sprintButton.classList.remove('touch__button--active');
    this.jumpButton.classList.remove('touch__button--active');
    this._setKnob(0, 0);
    this.input.setMove(STICK_SOURCE, 0, 0);
    this.input.release(STICK_SOURCE, InputActions.JUMP);
    this.input.release(STICK_SOURCE, InputActions.SPRINT);
  }

  dispose() {
    this._resetInputs();
    removeElement(this.root);
  }
}
