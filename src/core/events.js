/**
 * Minimal synchronous event bus.
 *
 * Systems never import each other directly; they publish and subscribe to
 * namespaced events instead. That keeps features such as the shrinking zone or
 * a kill feed addable without touching the systems that emit the data.
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  on(type, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const dispose = this.on(type, (payload) => {
      dispose();
      handler(payload);
    });
    return dispose;
  }

  off(type, handler) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(type);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    // Copy first: handlers are allowed to unsubscribe while being notified.
    for (const handler of [...set]) handler(payload);
  }

  clear(type) {
    if (type) this._listeners.delete(type);
    else this._listeners.clear();
  }
}

/** Convenience mixin for objects that need to own a bus. */
export class Emitter {
  constructor() {
    this.events = new EventBus();
  }

  on(type, handler) {
    return this.events.on(type, handler);
  }

  emit(type, payload) {
    this.events.emit(type, payload);
  }
}

export const GameEvents = {
  READY: 'game:ready',
  START: 'game:start',
  PAUSE: 'game:pause',
  RESUME: 'game:resume',
  ERROR: 'game:error',
  UPDATE: 'game:update', // per frame, { dt, elapsed, alpha }
  FIXED_UPDATE: 'game:fixedUpdate', // per fixed step, { dt, tick }
  RESIZE: 'game:resize', // { width, height, pixelRatio }
  DEBUG_TOGGLE: 'debug:toggle',
};
