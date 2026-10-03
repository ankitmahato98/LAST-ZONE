import { createElement, removeElement } from '../utils/dom.js';

/** Base HUD: location, brand, adaptive control hints and the static fallback reticle. */
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
    this.locationName = createElement('div', { className: 'hud__location-name', text: 'THE WILDS' });
    this.locationDetail = createElement('div', { className: 'hud__location-detail', text: 'Open terrain' });
    this.location = createElement('div', { className: 'hud__location' }, [this.locationName, this.locationDetail]);
    this.root = createElement('div', { className: 'hud' }, [
      this.crosshair,
      this.location,
      createElement('div', { className: 'hud__brand' }, [
        createElement('div', { className: 'hud__logo', html: 'LAST<span>ZONE</span>' }),
      ]),
      createElement('div', { className: 'hud__hint' }, [this.hintBody]),
    ]);
    this.uiRoot.appendChild(this.root);

    this._setHint(this.input?.controlMode ?? 'keyboard');
    this._unsubscribe = [];
    if (this.input?.events) {
      this._unsubscribe.push(this.input.events.on('controlmode', (mode) => this._setHint(mode)));
    }
    this._unsubscribe.push(game.bus.on('world:poi', ({ poi }) => this._setLocation(poi)));

    const player = game.services.get('player');
    const world = game.services.get('world');
    if (player?.position && world) this._setLocation(world.getPoiAt(player.position.x, player.position.z)?.poi ?? null);
  }

  _setLocation(poi) {
    this.locationName.textContent = poi?.name?.toUpperCase() ?? 'THE WILDS';
    this.locationDetail.textContent = poi
      ? `${poi.landmarkName ?? poi.landmark}  ·  ${poi.density?.toUpperCase() ?? 'SETTLEMENT'}`
      : 'Open terrain';
  }

  _setHint(mode) {
    if (!this.hintBody) return;
    this.hintBody.innerHTML = mode === 'touch'
      ? [
          'Left: move',
          'Right: look',
          '<b>Fire</b> / <b>Jump</b> / <b>Aim</b> / <b>Run</b> / <b>Reload</b>',
          '<b>Pick up</b> appears near loot',
          '<b>Swap</b> / <b>Drop</b> / <b>EP&rarr;HP</b>',
        ].join(' &middot; ')
      : [
          '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move',
          '<kbd>Shift</kbd> sprint',
          '<kbd>Space</kbd> jump',
          '<kbd>Mouse</kbd> fire',
          '<kbd>RMB</kbd> aim',
          '<kbd>R</kbd> reload',
          '<kbd>E</kbd> pick up',
          '<kbd>X</kbd> swap',
          '<kbd>G</kbd> drop',
          '<kbd>1</kbd>-<kbd>4</kbd> items',
          '<kbd>C</kbd> EP&rarr;HP',
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
    for (const off of this._unsubscribe ?? []) off();
    this._unsubscribe = [];
    removeElement(this.root);
    this.root = null;
  }
}
