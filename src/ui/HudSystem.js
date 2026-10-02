import { createElement, removeElement } from '../utils/dom.js';

/**
 * Heads-up display: crosshair, brand mark and the control hints.
 *
 * Deliberately text-only for now - health, ammo and the kill feed belong to
 * later systems, which can either extend this class or mount their own widget
 * into `#ui-root`. The hints adapt to whichever device was last used.
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
    this.root = createElement('div', { className: 'hud' }, [
      createElement('div', { className: 'hud__crosshair' }),
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
        ? 'Left side: move &middot; right side: look &middot; Run toggles sprint.'
        : [
            '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move',
            '<kbd>Shift</kbd> sprint',
            '<kbd>Space</kbd> jump',
            '<kbd>Mouse</kbd> look (click to capture)',
            '<kbd>Wheel</kbd> zoom',
            '<kbd>F3</kbd> debug',
            '<kbd>Esc</kbd> menu',
          ].join(' &middot; ');
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
