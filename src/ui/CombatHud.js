import { createElement, removeElement } from '../utils/dom.js';
import { clamp } from '../utils/math.js';
import { COMBAT } from '../config/settings.js';

/**
 * Combat HUD: reticle, health, ammo, reload indicator, hit markers, damage
 * feedback and the elimination banner.
 *
 * It is a *pure observer*: it reads the combat service and listens to bus events,
 * and never writes gameplay state. That means the HUD can be replaced (a mobile
 * layout, a spectator view) without touching combat.
 *
 * Performance note: the DOM is only touched when a value actually changes
 * (`_setText` / `_setStyle` guards), so a 60fps loop costs almost nothing.
 */
const RETICLE_PX_PER_RAD = 950; // spread (radians) -> crosshair gap (px)

export class CombatHud {
  constructor({ uiRoot } = {}) {
    this.name = 'combatHud';
    this.uiRoot = uiRoot;
    this.hitMarkerTimer = 0;
    this.damageFlash = 0;
  }

  init(game) {
    this.game = game;
    this.combat = game.services.get('combat');
    this.input = game.services.get('input');
    this._textCache = new Map();

    this.root = this._buildDom();
    this.uiRoot.appendChild(this.root);

    // The foundation HUD's static crosshair is replaced by this dynamic one.
    game.services.get('hud')?.setCrosshairVisible?.(false);

    this._unsubscribe = [
      game.bus.on('combat:hit', (payload) => this._onHit(payload)),
      game.bus.on('combat:kill', () => this._onKill()),
      game.bus.on('combat:player:hurt', ({ amount }) => this._onHurt(amount)),
      game.bus.on('combat:player:eliminated', (payload) => this._onEliminated(payload)),
      game.bus.on('weapon:reload:start', () => this._setReloading(true)),
      game.bus.on('weapon:reload:end', () => this._setReloading(false)),
      game.bus.on('weapon:dry', () => this._pulseReload()),
    ];

    this._setReloading(false);
    this._hideBanner();
  }

  // ------------------------------------------------------------------- dom --

  _buildDom() {
    // --- reticle: four ticks whose gap follows the weapon spread ----------
    const ticks = ['top', 'right', 'bottom', 'left'].map((side) =>
      createElement('span', { className: `reticle__tick reticle__tick--${side}` }),
    );
    this.hitMarker = createElement('div', {
      className: 'reticle__hitmarker',
      attrs: { 'data-role': 'hitmarker' },
    });
    this.reticle = createElement('div', { className: 'reticle' }, [
      createElement('div', { className: 'reticle__dot' }),
      ...ticks,
      this.hitMarker,
    ]);

    // --- vitals (bottom left) --------------------------------------------
    this.healthValue = createElement('span', { className: 'vitals__value', text: '100' });
    this.healthFill = createElement('div', { className: 'vitals__fill' });
    this.vitals = createElement('div', { className: 'vitals' }, [
      createElement('div', { className: 'vitals__row' }, [
        createElement('span', { className: 'vitals__label', text: 'Health' }),
        this.healthValue,
      ]),
      createElement('div', { className: 'vitals__bar' }, [this.healthFill]),
    ]);

    // --- ammo (bottom right) ---------------------------------------------
    this.weaponName = createElement('div', { className: 'ammo__name', text: 'RIFLE' });
    this.ammoMag = createElement('span', { className: 'ammo__mag', text: '30' });
    this.ammoReserve = createElement('span', { className: 'ammo__reserve', text: '/ 210' });
    this.reloadBar = createElement('div', { className: 'ammo__reload-fill' });
    this.reloadRow = createElement('div', { className: 'ammo__reload' }, [
      createElement('span', { className: 'ammo__reload-label', text: 'RELOADING' }),
      createElement('div', { className: 'ammo__reload-track' }, [this.reloadBar]),
    ]);
    this.kills = createElement('div', { className: 'ammo__kills', text: 'KILLS 0' });
    this.ammo = createElement('div', { className: 'ammo' }, [
      this.weaponName,
      createElement('div', { className: 'ammo__count' }, [this.ammoMag, this.ammoReserve]),
      this.reloadRow,
      this.kills,
    ]);

    // --- feedback layers --------------------------------------------------
    this.damageVignette = createElement('div', { className: 'damage-vignette' });
    this.banner = createElement('div', { className: 'banner' }, [
      createElement('div', { className: 'banner__title', text: 'ELIMINATED' }),
      createElement('div', { className: 'banner__sub', text: 'Eliminated for this run' }),
    ]);

    return createElement('div', { className: 'combat-hud' }, [
      this.damageVignette,
      this.reticle,
      this.vitals,
      this.ammo,
      this.banner,
    ]);
  }

  // --------------------------------------------------------------- updates --

  update(dt) {
    const combat = this.combat;
    if (!combat?.weapon) return;

    // --- reticle: gap follows the live spread ----------------------------
    const spread = combat.spread;
    const spreadPx = clamp(spread * RETICLE_PX_PER_RAD, 4, 46);
    const aiming = combat.aimBlend;
    this._setStyle(this.reticle, '--gap', `${(spreadPx * (1 - aiming * 0.6)).toFixed(1)}px`);
    this._setStyle(this.reticle, 'opacity', combat.isEliminated ? '0.25' : aiming > 0.5 ? '1' : '0.85');

    // --- vitals ----------------------------------------------------------
    const health = Math.round(combat.health);
    this._setText(this.healthValue, String(health));
    const fraction = combat.healthFraction;
    this._setStyle(this.healthFill, 'transform', `scaleX(${fraction.toFixed(3)})`);
    this._setStyle(
      this.healthFill,
      'background',
      fraction > 0.55 ? 'linear-gradient(90deg,#4ef0c8,#7ff5d8)'
        : fraction > 0.25 ? 'linear-gradient(90deg,#ffc95c,#ffe0a0)'
          : 'linear-gradient(90deg,#ff5f5f,#ff9a8a)',
    );
    this._setClass(this.vitals, 'vitals--critical', fraction <= 0.25);

    // --- ammo ------------------------------------------------------------
    const ammo = combat.ammo;
    this._setText(this.weaponName, combat.weapon.name.toUpperCase());
    this._setText(this.ammoMag, String(ammo.magazine));
    this._setText(this.ammoReserve, `/ ${ammo.reserve}`);
    this._setClass(this.ammoMag, 'ammo__mag--low', ammo.magazine <= Math.max(3, ammo.magazineSize * 0.2));
    this._setStyle(this.reloadBar, 'transform', `scaleX(${ammo.reloadProgress.toFixed(3)})`);
    this._setText(this.kills, `KILLS ${combat.kills}`);

    // --- timers ----------------------------------------------------------
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
      this._setStyle(this.hitMarker, 'opacity', String(clamp(this.hitMarkerTimer * 5, 0, 1)));
    }

    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
      this._setStyle(this.damageVignette, 'opacity', String(clamp(this.damageFlash, 0, 0.85)));
    }
  }

  // ---------------------------------------------------------------- events --

  _onHit({ headshot, killed }) {
    this.hitMarkerTimer = COMBAT.hitMarkerLifetime;
    this._setText(this.hitMarker, headshot ? '\u25CF' : '\u2715');
    this._setClass(this.hitMarker, 'reticle__hitmarker--headshot', Boolean(headshot) && !killed);
    this._setClass(this.hitMarker, 'reticle__hitmarker--kill', Boolean(killed));
    this._setStyle(this.hitMarker, 'opacity', '1');
  }

  _onKill() {
    // Set the state here as well as in `_onHit`: the kill feedback must not
    // depend on which of the two events arrives first.
    this.hitMarkerTimer = 0.35;
    this._setText(this.hitMarker, '\u2715');
    this._setClass(this.hitMarker, 'reticle__hitmarker--kill', true);
    this._setClass(this.hitMarker, 'reticle__hitmarker--headshot', false);
    this._setStyle(this.hitMarker, 'opacity', '1');
  }

  _onHurt(amount) {
    this.damageFlash = Math.min(0.85, this.damageFlash + clamp(amount / 45, 0.25, 0.7));
  }

  _onEliminated({ kills = 0 } = {}) {
    this.banner.classList.remove('banner--hidden');
    this.banner.querySelector('.banner__sub').textContent =
      `Kills: ${kills} \u00b7 You are out for this run`;
    this._setClass(this.root, 'combat-hud--dead', true);
  }

  _hideBanner() {
    this.banner?.classList.add('banner--hidden');
    this._setClass(this.root, 'combat-hud--dead', false);
  }

  _setReloading(reloading) {
    if (!this.reloadRow) return;
    this.reloadRow.classList.toggle('ammo__reload--active', Boolean(reloading));
  }

  _pulseReload() {
    this.reloadRow?.classList.add('ammo__reload--active');
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
