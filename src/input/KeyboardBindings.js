import { BINDINGS } from '../config/settings.js';
import { InputActions } from './InputSystem.js';

/**
 * Maps keyboard codes to actions and pushes them into the `keyboard` input
 * source. Bindings live in config/settings.js, so a remapping screen only has
 * to mutate that table and call `rebuild()`.
 *
 * Also swallows the browser defaults that would otherwise ruin the game:
 * space/arrow scrolling and Ctrl+W-style shortcuts are left alone, but Tab and
 * the space bar no longer scroll the page.
 */
const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'F3',
]);

export class KeyboardBindings {
  constructor({ input, bindings = BINDINGS } = {}) {
    this.name = 'keyboardBindings';
    this.input = input;
    this.bindings = bindings;
    /** @type {Map<string, string>} key code -> action */
    this.codeToAction = new Map();
    this.enabled = true;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);

    this.rebuild();
  }

  rebuild() {
    this.codeToAction.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes) this.codeToAction.set(code, action);
    }
  }

  init(game) {
    this.game = game;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  _onKeyDown(event) {
    if (PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault();
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const action = this.codeToAction.get(event.code);
    if (!action) return;
    // Ignore auto-repeat: edges are handled by the input system.
    if (event.repeat) return;

    this.input.setControlMode('keyboard');
    if (!this.enabled) return;
    this.input.press('keyboard', action);
  }

  _onKeyUp(event) {
    const action = this.codeToAction.get(event.code);
    if (!action) return;
    this.input.release('keyboard', action);
  }

  /** Losing focus mid-keypress would otherwise leave the player running. */
  _onBlur() {
    this.input.releaseAll();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.input.releaseAll();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}

export { InputActions };
