import { createElement, removeElement } from '../utils/dom.js';
import { InputActions } from '../input/InputSystem.js';

/**
 * Developer readout (F3, or `?debug=1`).
 *
 * Shows what the systems are actually doing - frame budget, simulation steps,
 * player kinematics and collision counts - so tuning movement or the world
 * happens with numbers instead of guesswork.
 */
const REFRESH_INTERVAL = 0.2; // seconds

export class DebugOverlay {
  constructor({ uiRoot, game, input }) {
    this.name = 'debugOverlay';
    this.uiRoot = uiRoot;
    this.visible = Boolean(game?.settings?.startDebug);
    this.root = null;
    this._accumulator = 0;
    this._text = '';
  }

  init(game) {
    this.game = game;
    this.input = game.services.get('input');
    this.player = game.services.get('player');
    this.world = game.services.get('world');
    this.camera = game.services.get('camera3p');
    this.combat = game.services.get('combat');
    this.targets = game.services.get('targets');
    this.vitals = game.services.get('vitals');
    this.loot = game.services.get('loot');
    this.inventory = game.services.get('inventory');

    this.content = createElement('div', { className: 'hud__debug' });
    this.root = createElement('div', {}, [this.content]);
    this.uiRoot.appendChild(this.root);
    this._applyVisibility();

    this._unsubscribe = [
      this.input?.onActionDown(({ action }) => {
        if (action === InputActions.TOGGLE_DEBUG) this.toggle();
        // Debug damage: exercise the hurt/death feedback without a shooter.
        if (action === InputActions.HURT_ME) {
          this.game.bus.emit('debug:damage', { amount: 25, source: 'debug' });
        }
      }),
      game.bus.on('game:resize', () => this._render(true)),
    ];
  }

  toggle() {
    this.visible = !this.visible;
    this._applyVisibility();
  }

  _applyVisibility() {
    if (this.content) this.content.style.display = this.visible ? '' : 'none';
  }

  update(dt) {
    if (!this.visible) return;
    this._accumulator += dt;
    if (this._accumulator < REFRESH_INTERVAL) return;
    this._accumulator = 0;
    this._render();
  }

  _render() {
    if (!this.visible || !this.content) return;
    const { game, player, world, input } = this;
    if (!game || !player) return;

    const state = player.state;
    const renderer = game.services.get('renderer');
    const metrics = game.loop.metrics;

    const lines = [
      `<b>LAST ZONE</b> ${game.settings.profile} &middot; ${input?.controlMode ?? '-'}`,
      `quality pbr:${game.settings.quality?.pbrMaps ? 'on' : 'off'} fx:${renderer?.stats.postFx ? 'on' : 'off'} tex ${game.settings.quality?.textureSize ?? '-'}`,
      `fps ${metrics.fps.toFixed(0)}  frame ${metrics.frameMs.toFixed(1)}ms  steps ${metrics.stepsThisFrame}`,
      `draws ${renderer?.stats.calls ?? 0}  tris ${format(renderer?.stats.triangles ?? 0)}`,
      `pos ${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}`,
      `speed ${state.speed.toFixed(2)} m/s  ${state.onGround ? 'grounded' : 'airborne'}`,
      `vel.y ${state.velocity.y.toFixed(2)}  yaw ${((state.yaw * 180) / Math.PI).toFixed(0)}\u00b0`,
      `cam ${this.camera ? this.camera.currentDistance.toFixed(2) : '-'}m  zoom ${this.camera?.distance.toFixed(1) ?? '-'}`,
      `colliders ${world?.stats.boxes ?? 0} box / ${world?.stats.cylinders ?? 0} cyl`,
      `props ${world?.stats.props.trees ?? 0} trees, ${world?.stats.props.rocks ?? 0} rocks`,
    ];

    const combat = this.combat;
    if (combat) {
      const ammo = combat.ammo;
      const stats = combat.stats;
      const weaponLabel = combat.weapon
        ? `${combat.weapon.name}  ${ammo.magazine}/${ammo.reserve}${ammo.reloading ? '  RELOADING' : ''}`
        : 'unarmed - find a weapon crate';
      lines.push(
        '',
        `<b>${weaponLabel}</b>`,
        `hp ${combat.health.toFixed(0)}/${combat.maxHealth}  ep ${(this.vitals?.energy ?? 0).toFixed(0)}/${this.vitals?.maxEnergy ?? 0}`
          + `  ${this.vitals?.converting ? 'CONVERTING' : ''}`,
        `${combat.isEliminated ? 'ELIMINATED' : combat.isProtected ? 'spawn-protected' : 'alive'}`,
        `spread ${(combat.spread * 1000).toFixed(1)}mrad  aim ${combat.aimBlend.toFixed(2)}  recoil ${this.camera?.recoil?.pitch?.toFixed(4) ?? '-'}`,
        `shots ${stats.shots}  hits ${stats.hits}  head ${stats.headshots}  kills ${stats.kills}`,
        `damage dealt ${stats.damageDealt.toFixed(0)}  taken ${stats.damageTaken.toFixed(0)}`,
        `targets ${this.targets?.aliveCount ?? 0}/${this.targets?.dummies.length ?? 0} standing`,
      );
    }

    const loot = this.loot;
    const inventory = this.inventory?.inventory;
    if (loot) {
      const prompt = this.inventory?.prompt;
      lines.push(
        '',
        `loot ${loot.stats.pickups} pickups  ${loot.stats.anchors} anchors  ${loot.pickups.filter((p) => p.active).length} live`,
        `nearby ${prompt ? `${prompt.name} (${prompt.label})` : '—'}`,
      );
      if (inventory) {
        lines.push(
          `slots ${inventory.weapons.map((w) => (w ? w.id : '—')).join(' | ')}`
            + `  ammo ${[...inventory.ammo.entries()].map(([type, count]) => `${type}:${count}`).join(' ') || '0'}`,
          `items ${inventory.consumables.map((stack) => `${stack.itemId} x${stack.quantity}`).join(', ') || '—'}`
            + `  ${this.inventory?.using ? `using ${this.inventory.usingItemId}` : ''}`,
        );
      }
    }

    const next = lines.join('\n');
    if (next !== this._text) {
      this._text = next;
      this.content.innerHTML = next;
    }
  }

  dispose() {
    for (const off of this._unsubscribe ?? []) off();
    removeElement(this.root);
    this.root = null;
  }
}

function format(value) {
  if (value > 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value > 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}
