import { createElement, removeElement } from '../utils/dom.js';

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

    this.content = createElement('div', { className: 'hud__debug' });
    this.root = createElement('div', {}, [this.content]);
    this.uiRoot.appendChild(this.root);
    this._applyVisibility();

    this._unsubscribe = [
      this.input?.onActionDown(({ action }) => {
        if (action === 'toggleDebug') this.toggle();
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
      `fps ${metrics.fps.toFixed(0)}  frame ${metrics.frameMs.toFixed(1)}ms  steps ${metrics.stepsThisFrame}`,
      `draws ${renderer?.stats.calls ?? 0}  tris ${format(renderer?.stats.triangles ?? 0)}`,
      `pos ${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}`,
      `speed ${state.speed.toFixed(2)} m/s  ${state.onGround ? 'grounded' : 'airborne'}`,
      `vel.y ${state.velocity.y.toFixed(2)}  yaw ${((state.yaw * 180) / Math.PI).toFixed(0)}\u00b0`,
      `cam ${this.camera ? this.camera.currentDistance.toFixed(2) : '-'}m  zoom ${this.camera?.distance.toFixed(1) ?? '-'}`,
      `colliders ${world?.stats.boxes ?? 0} box / ${world?.stats.cylinders ?? 0} cyl`,
      `props ${world?.stats.props.trees ?? 0} trees, ${world?.stats.props.rocks ?? 0} rocks`,
    ];

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
