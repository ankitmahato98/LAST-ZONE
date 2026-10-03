import { createElement, isCoarsePointer, removeElement } from '../utils/dom.js';
import { GameEvents } from '../core/events.js';

/**
 * Front end: start menu, pause menu and the control reference.
 *
 * The menu is a thin controller over the game shell - it enables/disables input,
 * pauses the simulation and asks the pointer-look system for the cursor. All
 * game state it touches is reached through services, so replacing this with a
 * lobby screen later means implementing the same two callbacks
 * (`close()` to deploy, `open()` to pause) against a match/lobby service.
 */
export class MenuSystem {
  constructor({ uiRoot, pointerLook = null, touch = null, input }) {
    this.name = 'menu';
    this.uiRoot = uiRoot;
    this.pointerLook = pointerLook;
    this.touch = touch;
    this.input = input;

    this.isOpen = false;
    this.hasStarted = false;
    this.hadPointerLock = false;
    this._cleanups = [];
  }

  init(game) {
    this.game = game;
    this.overlay = this._buildOverlay();
    this.uiRoot.appendChild(this.overlay);

    this._onKeyDown = (event) => {
      if (event.code === 'Escape') this.open({ reason: 'escape' });
    };
    this._onVisibility = () => {
      if (document.hidden && this.game.status === 'running') this.open({ reason: 'hidden' });
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('visibilitychange', this._onVisibility);
    this._cleanups.push(
      this.input.events.on('pointerlockchange', ({ locked }) => this._onLockChange(locked)),
      // The loop starts after the UI is built; make sure a menu that is already
      // open keeps the world paused.
      game.bus.on(GameEvents.START, () => {
        if (this.isOpen) this.game.pause();
      }),
      () => window.removeEventListener('keydown', this._onKeyDown),
      () => window.removeEventListener('visibilitychange', this._onVisibility),
    );

    this.open({ reason: 'boot' });
  }

  // ------------------------------------------------------------------- dom --

  _buildOverlay() {
    const coarse = isCoarsePointer();

    this.startButton = createElement('button', {
      className: 'button',
      text: 'Enter Island',
      attrs: { type: 'button' },
      on: { click: () => this.close() },
    });

    this.subtitle = createElement('p', {
      className: 'panel__subtitle',
      text: coarse ? 'Touch controls active' : 'Single-player battle royale',
    });

    const controls = createElement('div', { className: 'controls' }, [
      group('Move', [
        ['W A S D', 'walk / strafe'],
        ['Shift', 'sprint'],
        ['Space', 'jump'],
      ]),
      group('Combat', [
        ['LMB / F', 'fire'],
        ['RMB / Q', 'aim down sights'],
        ['R', 'reload'],
        ['H', 'test: take 25 damage'],
      ]),
      group('Camera', [
        ['Mouse', 'look'],
        ['Wheel', 'zoom'],
        ['I K J L', 'look without a mouse'],
      ]),
      group('Touch', [
        ['Left half', 'move'],
        ['Right half', 'look'],
        ['Fire', 'hold to shoot'],
        ['Aim / Run', 'toggle'],
        ['Reload / Jump', 'tap'],
      ]),
      group('System', [
        ['F3', 'debug overlay'],
        ['T', 'toggle touch pad'],
        ['Esc', 'pause'],
      ]),
    ]);

    const note = createElement('p', {
      className: 'panel__note',
      text:
        'Single-player island foundation: one rifle, hitscan combat and training targets. ' +
        'Elimination is final for this run; there is no player respawn.',
    });

    return createElement('div', { className: 'overlay' }, [
      createElement('div', { className: 'panel' }, [
        createElement('h1', { className: 'panel__title', html: 'LAST<span>ZONE</span>' }),
        this.subtitle,
        createElement('div', { className: 'panel__actions' }, [this.startButton]),
        controls,
        note,
      ]),
    ]);
  }

  // ---------------------------------------------------------------- control --

  open({ reason = 'manual' } = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.overlay.classList.remove('overlay--hidden');
    this.startButton.textContent = this.hasStarted ? 'Resume' : 'Enter Island';
    this.subtitle.textContent = reason === 'boot' ? 'Single-player battle royale' : 'Paused';

    this.input.setEnabled(false);
    this.touch?.setVisible(false);
    this.pointerLook?.releaseLock();
    this.game.pause();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.add('overlay--hidden');

    this.hasStarted = true;
    this.input.setEnabled(true);
    if (this.touch) this.touch.setVisible(this.touch.shouldStartVisible());
    if (this.pointerLook?.lockSupported && !isCoarsePointer()) this.pointerLook.requestLock();
    this.game.resume();
  }

  togglePause() {
    if (this.isOpen) this.close();
    else this.open({ reason: 'manual' });
  }

  _onLockChange(locked) {
    if (locked) {
      this.hadPointerLock = true;
      return;
    }
    // Losing the cursor (Esc, alt-tab, clicking outside) pauses the match.
    if (this.hadPointerLock && !this.isOpen && this.game.status === 'running') {
      this.open({ reason: 'lock-lost' });
    }
  }

  dispose() {
    for (const cleanup of this._cleanups) cleanup();
    this._cleanups = [];
    removeElement(this.overlay);
    this.overlay = null;
  }
}

/** A definition list of key -> action rows. */
function group(title, rows) {
  const list = createElement('dl');
  for (const [key, label] of rows) {
    list.append(
      createElement('dt', { text: key }),
      createElement('dd', { text: label }),
    );
  }
  return createElement('div', { className: 'controls__group' }, [
    createElement('h3', { text: title }),
    list,
  ]);
}
