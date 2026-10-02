import { createElement, removeElement } from '../utils/dom.js';

/**
 * Base heads-up display: brand mark and the adaptive control hints.
 *
 * Health/ammo/reticle live in `ui/CombatHud.js`, which owns the crosshair while
 * combat is active - this system's static crosshair is hidden in that case
 * (`setCrosshairVisible(false)`), so there is exactly one reticle on screen.
 */
export class HudSystem {
  constructor({ uiRoot }) {
    this.name = 'hud';
    this.uiRoot = uiRoot;
    this.root = null;
  }

  init(game) {
    this.game = game;
    this.input = game.services.get('input');

    this.hintBody = createElement('div', { className: 'hud__hint-body' });
    this.crosshair = createElement('div', { className: 'hud__crosshair' });
    this.root = createElement('div', { className: 'hud' }, [
      this.crosshair,
      createElement('div', { className: 'hud__brand' }, [
        createElement('div', { className: 'hud__logo', html: 'LAST<span>ZONE</span>' }),
      ]),
      createElement('div', { className: 'hud__hint' }, [this.hintBody]),
    ]);
    this.uiRoot.appendChild(this.root);

    this._setHint(this.input?.controlMode ?? 'keyboard');
    this._unsubscribe = this.input?.events.on('controlmode', (mode) => this._setHint(mode));
  }

  _setHint(mode) {
    if (!this.hintBody) return;
    this.hintBody.innerHTML =
      mode === 'touch'
        ? [
            'Left: move',
            'Right: look',
            '<b>Fire</b> / <b>Jump</b> / <b>Aim</b> / <b>Run</b> / <b>Reload</b> buttons',
          ].join(' &middot; ')
        : [
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move',
            '<kbd>Shift</kbd> sprint',
            '<kbd>Space</kbd> jump',
            '<kbd>Mouse</kbd> fire (click the view to capture)',
            '<kbd>RMB</kbd> aim',
            '<kbd>R</kbd> reload',
            '<kbd>Wheel</kbd> zoom',
            '<kbd>F3</kbd> debug',
            '<kbd>Esc</kbd> menu',
          ].join(' &middot; ');
  }

  /** The combat HUD takes over the reticle once weapons are equipped. */
  setCrosshairVisible(visible) {
    if (this.crosshair) this.crosshair.style.display = visible ? '' : 'none';
  }

  setVisible(visible) {
    if (this.root) this.root.style.display = visible ? '' : 'none';
  }

  dispose() {
    this._unsubscribe?.();
    removeElement(this.root);
    this.root = null;
  }
}
