import { EventBus, GameEvents } from './events.js';
import { ServiceRegistry } from './services.js';
import { Loop } from './Loop.js';

/**
 * The game shell: owns the canvas, the service registry, the systems and the
 * loop. A system is any object that implements a subset of
 * `{ init, fixedUpdate, lateFixedUpdate, update, render, resize, dispose }`.
 *
 * Registration order === update order, so the dependency order is explicit:
 * input -> world -> player -> camera -> ui. `render()` is called in a second
 * pass after every `update()`, so the renderer always draws the freshest frame
 * regardless of where it sits in the list.
 */
export class Game {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} [options.uiRoot]
   * @param {object} [options.settings]
   */
  constructor({ canvas, uiRoot = null, settings = {} } = {}) {
    if (!canvas) throw new Error('Game requires a canvas element');

    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = settings;
    this.bus = settings.bus ?? new EventBus();
    this.services = new ServiceRegistry();
    this.loop = new Loop({ bus: this.bus, fixedStep: settings.fixedStep });

    /** @type {Array<{name?: string}>} */
    this.systems = [];
    this.systemMap = new Map();

    this.status = 'created'; // created -> ready -> running -> paused -> disposed
    this.timeScale = 1;
    this.elapsed = 0;

    this.size = { width: 1, height: 1, pixelRatio: 1 };

    this._unsubscribe = [];
    this._onResizeBound = this._onResize.bind(this);
  }

  // ------------------------------------------------------------- systems --

  addSystem(system) {
    const name = system.name ?? `system-${this.systems.length}`;
    if (this.systemMap.has(name)) throw new Error(`System "${name}" already added`);
    this.systems.push(system);
    this.systemMap.set(name, system);
    if (this.status !== 'created') this._initSystem(system);
    return system;
  }

  getSystem(name) {
    return this.systemMap.get(name);
  }

  // ------------------------------------------------------------ lifecycle --

  async init() {
    this.services.register('game', this);
    this.services.register('bus', this.bus);
    this.services.register('canvas', this.canvas);
    this.services.register('settings', this.settings);

    for (const system of this.systems) await this._initSystem(system);

    window.addEventListener('resize', this._onResizeBound, { passive: true });
    window.addEventListener('orientationchange', this._onResizeBound, { passive: true });
    window.visualViewport?.addEventListener('resize', this._onResizeBound, { passive: true });

    this._unsubscribe.push(
      this.bus.on(GameEvents.FIXED_UPDATE, (payload) => this._fixedUpdate(payload)),
      this.bus.on(GameEvents.UPDATE, (payload) => this._update(payload)),
    );

    this._onResize();
    this.status = 'ready';
    this.bus.emit(GameEvents.READY, { game: this });
    return this;
  }

  start() {
    if (this.status === 'disposed') throw new Error('Cannot start a disposed game');
    this.status = 'running';
    this.loop.start();
    this.bus.emit(GameEvents.START, { game: this });
    return this;
  }

  pause() {
    if (this.status !== 'running') return this;
    this.status = 'paused';
    this.bus.emit(GameEvents.PAUSE, { game: this });
    return this;
  }

  resume() {
    if (this.status !== 'paused') return this;
    this.status = 'running';
    this.bus.emit(GameEvents.RESUME, { game: this });
    return this;
  }

  /** Simulation is skipped while paused; rendering keeps running. */
  get isSimulating() {
    return this.status === 'running';
  }

  dispose() {
    this.loop.stop();
    for (const off of this._unsubscribe) off();
    this._unsubscribe.length = 0;
    window.removeEventListener('resize', this._onResizeBound);
    window.removeEventListener('orientationchange', this._onResizeBound);
    window.visualViewport?.removeEventListener('resize', this._onResizeBound);

    for (const system of [...this.systems].reverse()) {
      try {
        system.dispose?.();
      } catch (error) {
        console.error('[game] failed to dispose system', system.name, error);
      }
    }
    this.systems.length = 0;
    this.systemMap.clear();
    this.bus.clear();
    this.status = 'disposed';
  }

  // --------------------------------------------------------------- dispatch --

  async _initSystem(system) {
    await system.init?.(this);
  }

  _fixedUpdate(payload) {
    if (!this.isSimulating) return;
    const dt = payload.dt * this.timeScale;
    for (const system of this.systems) system.fixedUpdate?.(dt, payload.tick, this);
    for (const system of this.systems) system.lateFixedUpdate?.(dt, payload.tick, this);
  }

  _update(payload) {
    const dt = Math.min(payload.dt, 0.25);
    this.elapsed = payload.elapsed;
    for (const system of this.systems) system.update?.(dt, payload);
    // Second pass: rendering happens after all simulation/visual updates.
    for (const system of this.systems) system.render?.(dt, payload);
  }

  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio ?? 2);
    this.size.width = width;
    this.size.height = height;
    this.size.pixelRatio = pixelRatio;

    for (const system of this.systems) {
      try {
        system.resize?.(width, height, pixelRatio, this);
      } catch (error) {
        console.error('[game] resize failed for system', system.name, error);
      }
    }
    this.bus.emit(GameEvents.RESIZE, { width, height, pixelRatio });
  }
}
