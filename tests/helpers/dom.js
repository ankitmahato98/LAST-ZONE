import { JSDOM } from 'jsdom';

/**
 * Minimal DOM for the test suite.
 *
 * jsdom gives us real elements, events and layout-free geometry, which is
 * enough to exercise every system except WebGL itself (see headlessRenderer.js).
 * PointerEvent and pointer capture are not implemented by jsdom, so they are
 * polyfilled here - the touch controls are written against the standard API.
 */
export function installDom({ width = 1280, height = 720 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <canvas id="game-canvas"></canvas>
      <div id="ui-root"></div>
    </body></html>`,
    { pretendToBeVisual: true, url: 'http://localhost/' },
  );

  const { window } = dom;

  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, params = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
        this.pointerType = params.pointerType ?? 'touch';
        this.isPrimary = params.isPrimary ?? true;
      }
    };
  }

  for (const proto of [window.Element.prototype, window.HTMLElement.prototype]) {
    if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
    if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
    if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  }

  if (!window.HTMLElement.prototype.requestPointerLock) {
    window.HTMLElement.prototype.requestPointerLock = function requestPointerLock() {
      throw new Error('pointer lock not available');
    };
  }

  window.innerWidth = width;
  window.innerHeight = height;
  window.devicePixelRatio = 1;

  const globals = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLCanvasElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'PointerEvent',
    'CustomEvent',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'getComputedStyle',
  ];
  // Node >= 21 exposes `navigator` as a getter-only global, so define every
  // global explicitly instead of assigning.
  for (const key of globals) {
    if (window[key] === undefined) continue;
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
  if (!globalThis.performance?.now) {
    Object.defineProperty(globalThis, 'performance', {
      value: window.performance,
      configurable: true,
      writable: true,
    });
  }
  // three.js checks for `self` in a few feature detections.
  globalThis.self ??= window;

  return { dom, window };
}

/** Dispatch a pointer event with the pointer fields jsdom drops. */
export function pointer(target, type, params = {}) {
  const view =
    target.defaultView ?? target.ownerDocument?.defaultView ?? globalThis.window;
  const event = new view.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: params.clientX ?? 0,
    clientY: params.clientY ?? 0,
    button: params.button ?? 0,
    buttons: params.buttons ?? 1,
  });
  event.pointerId = params.pointerId ?? 1;
  event.pointerType = params.pointerType ?? 'touch';
  event.isPrimary = true;
  target.dispatchEvent(event);
  return event;
}

export function key(window, type, code) {
  const event = new window.KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/** Advance the game by `seconds` in fixed steps (deterministic, no rAF). */
export function advance(game, seconds, step = 1 / 60) {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i += 1) game.loop.advance(step);
}
