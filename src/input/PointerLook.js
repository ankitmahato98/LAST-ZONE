import { exitPointerLockSafe, requestPointerLockSafe } from '../utils/dom.js';

/**
 * Mouse look for desktop.
 *
 * Two modes, chosen automatically:
 *  1. **Pointer lock** (preferred). Click the canvas -> the cursor is captured,
 *     `movementX/Y` drives the camera, ESC releases.
 *  2. **Drag to look** - used when pointer lock is unavailable (embedded
 *     iframes without `allow="pointer-lock"`, some kiosk browsers). The same
 *     code path then runs off absolute mouse deltas, so the game is always
 *     playable.
 *
 * Sensitivity is *not* applied here: raw pixels go into the intent and the
 * camera applies `config/settings.js` values. That keeps look tuning in one
 * place for every device.
 */
export class PointerLook {
  constructor({ canvas, input }) {
    this.name = 'pointerLook';
    this.canvas = canvas;
    this.input = input;

    this.source = 'mouse';
    this.isLocked = false;
    this.lockSupported = true;
    this.isDragging = false;
    this.enabled = true;

    this._last = { x: 0, y: 0 };
    this._draggingButton = -1;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onContextMenu = (event) => event.preventDefault();
  }

  init(game) {
    this.game = game;
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.isDragging = false;
  }

  /** Requested by the menu's Play button, or by clicking the canvas. */
  async requestLock() {
    if (!this.enabled || this.isLocked) return false;
    const ok = await requestPointerLockSafe(this.canvas);
    if (!ok) {
      // Fall back to drag-look for the rest of the session.
      this.lockSupported = false;
      this.input.events.emit('pointerlockchange', { locked: false, supported: false });
    }
    return ok;
  }

  releaseLock() {
    exitPointerLockSafe();
  }

  _onPointerDown(event) {
    if (event.pointerType === 'touch') return;
    if (!this.enabled) return;

    this.input.setControlMode('keyboard');
    this._draggingButton = event.button;
    this._last.x = event.clientX;
    this._last.y = event.clientY;

    // Clicking the game view captures the cursor; if that is not possible we
    // simply keep dragging.
    if (!this.isLocked && this.lockSupported && event.button === 0) {
      this.requestLock();
    }

    if (!this.isLocked) this.isDragging = true;
  }

  _onPointerMove(event) {
    if (!this.enabled || event.pointerType === 'touch') return;

    let dx = 0;
    let dy = 0;

    if (this.isLocked) {
      dx = event.movementX ?? 0;
      dy = event.movementY ?? 0;
    } else if (this.isDragging) {
      dx = event.clientX - this._last.x;
      dy = event.clientY - this._last.y;
      this._last.x = event.clientX;
      this._last.y = event.clientY;
    } else {
      return;
    }

    if (dx === 0 && dy === 0) return;
    this.input.addLook(this.source, dx, dy);
  }

  _onPointerUp(event) {
    if (event.pointerType === 'touch') return;
    if (event.button === this._draggingButton || this._draggingButton === -1) {
      this.isDragging = false;
    }
  }

  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.input.addZoom(this.source, event.deltaY > 0 ? 1 : -1);
  }

  _onLockChange() {
    const wasLocked = this.isLocked;
    this.isLocked = document.pointerLockElement === this.canvas;
    if (this.isLocked) this.isDragging = false;
    if (wasLocked !== this.isLocked) {
      this.input.events.emit('pointerlockchange', { locked: this.isLocked, supported: true });
    }
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
  }
}
