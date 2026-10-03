import { EventBus } from '../core/events.js';
import { clamp } from '../utils/math.js';

/**
 * Device-agnostic input.
 *
 * Every device (keyboard, mouse-drag, touch, and later a gamepad or a network
 * packet) is an *input source*. Sources write raw device state; this system
 * merges them once per fixed step into a single immutable-shaped `intent`
 * object. Gameplay code only ever reads `intent`:
 *
 *   intent.move    { x, y }  -1..1, y = forward, x = strafe right
 *   intent.look    { x, y }  pixels accumulated since the last simulation step
 *   intent.zoom     number   wheel/tap zoom steps
 *   intent.jumpHeld / intent.sprintHeld / intent.aimHeld   (held buttons)
 *   intent.jumpQueued / intent.primaryPressed / intent.reloadPressed (edges)
 *   intent.primaryHeld   (held: automatic fire, mobile fire button)
 *   intent.interactPressed / intent.swapPressed / intent.dropPressed (edges)
 *   intent.convertPressed  (edge: toggle EP -> HP conversion)
 *   intent.useItemPressed  fixed array, one edge flag per consumable quick slot
 *   intent.active  'keyboard' | 'touch'   (last device that produced input)
 *
 * That indirection is what makes the player controller reusable for a network
 * driven pawn later on: swap the source, keep the controller.
 */

export const InputActions = Object.freeze({
  FORWARD: 'forward',
  BACKWARD: 'backward',
  LEFT: 'left',
  RIGHT: 'right',
  JUMP: 'jump',
  SPRINT: 'sprint',
  /** Trigger. Held for automatic fire, edge for single shots. */
  PRIMARY: 'primary',
  /** Aim down sights / shoulder aim. Held. */
  AIM: 'aim',
  /** Manual reload. Edge triggered. */
  RELOAD: 'reload',
  /** Pick up / swap the loot under the prompt. Edge triggered. */
  INTERACT: 'interact',
  /** Switch between weapon slots. Edge triggered. */
  SWAP_WEAPON: 'swapWeapon',
  /** Drop the equipped weapon into the world. Edge triggered. */
  DROP_WEAPON: 'dropWeapon',
  /** Start/stop converting EP into HP. Edge triggered. */
  CONVERT: 'convert',
  /** Quick-use consumable stacks, in inventory order. Edge triggered. */
  USE_ITEM_1: 'useItem1',
  USE_ITEM_2: 'useItem2',
  USE_ITEM_3: 'useItem3',
  USE_ITEM_4: 'useItem4',
  /** Debug-only: hurt me so the damage feedback can be tested in game. */
  HURT_ME: 'hurtMe',
  TOGGLE_DEBUG: 'toggleDebug',
  TOGGLE_TOUCH: 'toggleTouch',
});

/** Quick-use actions, in slot order - index === inventory consumable index. */
export const USE_ITEM_ACTIONS = Object.freeze([
  InputActions.USE_ITEM_1,
  InputActions.USE_ITEM_2,
  InputActions.USE_ITEM_3,
  InputActions.USE_ITEM_4,
]);

/** Movement actions that contribute to the movement axis. */
const MOVEMENT_ACTIONS = {
  [InputActions.FORWARD]: [0, 1],
  [InputActions.BACKWARD]: [0, -1],
  [InputActions.RIGHT]: [1, 0],
  [InputActions.LEFT]: [-1, 0],
};

/** Max look pixels buffered between simulation steps (guards against spies). */
const LOOK_SPIKE_LIMIT = 600;

export class InputSource {
  constructor(name) {
    this.name = name;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    /** @type {Set<string>} */
    this.buttons = new Set();
  }
}

export class InputSystem {
  constructor() {
    this.name = 'input';
    this.events = new EventBus();

    /** @type {Map<string, InputSource>} */
    this.sources = new Map();
    /** @type {Map<string, Set<string>>} actions currently held, per action */
    this.enabled = true;
    this.controlMode = 'keyboard';

    this.intent = {
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      zoom: 0,
      jumpHeld: false,
      sprintHeld: false,
      jumpQueued: false,
      primaryHeld: false,
      primaryPressed: false,
      aimHeld: false,
      reloadPressed: false,
      interactPressed: false,
      swapPressed: false,
      dropPressed: false,
      convertPressed: false,
      /** One flag per consumable quick slot; mutated in place (no alloc). */
      useItemPressed: [false, false, false, false],
      active: 'keyboard',
    };

    this._held = new Set(); // merged buttons from all sources
    this._pressedQueue = new Set(); // button edges since the last fixed step
    this._releasedQueue = new Set();
  }

  // --------------------------------------------------------------- sources --

  /** Get (or lazily create) a named input source. */
  source(name) {
    let source = this.sources.get(name);
    if (!source) {
      source = new InputSource(name);
      this.sources.set(name, source);
    }
    return source;
  }

  /** Highest priority device wins the "active" label for UI hints. */
  setControlMode(mode) {
    if (this.controlMode === mode) return;
    this.controlMode = mode;
    this.intent.active = mode;
    this.events.emit('controlmode', mode);
  }

  // -------------------------------------------------------- source writing --

  setMove(name, x, y) {
    const source = this.source(name);
    source.move.x = clamp(x, -1, 1);
    source.move.y = clamp(y, -1, 1);
    this.setControlMode(name === 'touch' ? 'touch' : 'keyboard');
  }

  addLook(name, dx, dy) {
    if (!this.enabled) return;
    const source = this.source(name);
    source.look.x = clamp(source.look.x + dx, -LOOK_SPIKE_LIMIT, LOOK_SPIKE_LIMIT);
    source.look.y = clamp(source.look.y + dy, -LOOK_SPIKE_LIMIT, LOOK_SPIKE_LIMIT);
    this.setControlMode(name === 'touch' ? 'touch' : 'keyboard');
  }

  addZoom(name, steps) {
    if (!this.enabled) return;
    this.source(name).zoom += steps;
  }

  press(name, action) {
    const source = this.source(name);
    source.buttons.add(action);
    this.setControlMode(name === 'touch' ? 'touch' : 'keyboard');
    if (!this.enabled) return;
    if (!this._held.has(action)) {
      this._pressedQueue.add(action);
      this.events.emit('action:down', { action, source: name });
    }
  }

  release(name, action) {
    this.source(name).buttons.delete(action);
    if (!this.enabled) return;
    // Only report the release once every source has let go.
    let stillHeld = false;
    for (const source of this.sources.values()) {
      if (source.buttons.has(action)) stillHeld = true;
    }
    if (!stillHeld && this._held.has(action)) {
      this._releasedQueue.add(action);
      this.events.emit('action:up', { action, source: name });
    }
  }

  isHeld(action) {
    return this._held.has(action);
  }

  wasPressed(action) {
    return this._pressedQueue.has(action);
  }

  /** Release everything - used when the game pauses. */
  releaseAll() {
    for (const source of this.sources.values()) {
      for (const action of source.buttons) this._releasedQueue.add(action);
      source.buttons.clear();
      source.move.x = 0;
      source.move.y = 0;
      source.look.x = 0;
      source.look.y = 0;
      source.zoom = 0;
    }
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  // ------------------------------------------------------ merged read/write --

  /** Called by the camera system once per simulation step. */
  consumeLook(out) {
    out.x = this.intent.look.x;
    out.y = this.intent.look.y;
    this.intent.look.x = 0;
    this.intent.look.y = 0;
    return out;
  }

  consumeZoom() {
    const zoom = this.intent.zoom;
    this.intent.zoom = 0;
    return zoom;
  }

  // --------------------------------------------------------------- lifecycle --

  onActionDown(handler) {
    return this.events.on('action:down', handler);
  }

  fixedUpdate() {
    const intent = this.intent;

    if (!this.enabled) {
      intent.move.x = 0;
      intent.move.y = 0;
      intent.jumpHeld = false;
      intent.sprintHeld = false;
      intent.jumpQueued = false;
      intent.primaryHeld = false;
      intent.primaryPressed = false;
      intent.aimHeld = false;
      intent.reloadPressed = false;
      intent.interactPressed = false;
      intent.swapPressed = false;
      intent.dropPressed = false;
      intent.convertPressed = false;
      intent.useItemPressed.fill(false);
      this._held.clear();
      this._pressedQueue.clear();
      this._releasedQueue.clear();
      return;
    }

    // --- merge movement from every source, then clamp the magnitude -------
    // An analog stick writes `source.move` directly; digital keys press the
    // movement actions. Both end up in the same axis, so gameplay code does
    // not have to know which device is talking.
    let moveX = 0;
    let moveY = 0;
    let lookX = 0;
    let lookY = 0;
    let zoom = 0;
    const held = this._held;

    held.clear();
    for (const source of this.sources.values()) {
      let axisX = source.move.x;
      let axisY = source.move.y;
      for (const action of source.buttons) {
        const axis = MOVEMENT_ACTIONS[action];
        if (axis) {
          axisX += axis[0];
          axisY += axis[1];
        }
      }
      moveX += clamp(axisX, -1, 1);
      moveY += clamp(axisY, -1, 1);
      lookX += source.look.x;
      lookY += source.look.y;
      zoom += source.zoom;
      for (const action of source.buttons) held.add(action);
      source.look.x = 0;
      source.look.y = 0;
      source.zoom = 0;
    }

    const length = Math.hypot(moveX, moveY);
    if (length > 1) {
      moveX /= length;
      moveY /= length;
    }

    intent.move.x = moveX;
    intent.move.y = moveY;
    intent.look.x = lookX;
    intent.look.y = lookY;
    intent.zoom = zoom;
    intent.jumpHeld = held.has(InputActions.JUMP);
    intent.sprintHeld = held.has(InputActions.SPRINT);
    intent.aimHeld = held.has(InputActions.AIM);
    intent.primaryHeld = held.has(InputActions.PRIMARY);
    // Edges: consumed here so each press is delivered exactly once.
    intent.jumpQueued = this._pressedQueue.has(InputActions.JUMP);
    intent.primaryPressed = this._pressedQueue.has(InputActions.PRIMARY);
    intent.reloadPressed = this._pressedQueue.has(InputActions.RELOAD);
    intent.interactPressed = this._pressedQueue.has(InputActions.INTERACT);
    intent.swapPressed = this._pressedQueue.has(InputActions.SWAP_WEAPON);
    intent.dropPressed = this._pressedQueue.has(InputActions.DROP_WEAPON);
    intent.convertPressed = this._pressedQueue.has(InputActions.CONVERT);
    for (let i = 0; i < USE_ITEM_ACTIONS.length; i += 1) {
      intent.useItemPressed[i] = this._pressedQueue.has(USE_ITEM_ACTIONS[i]);
    }
    intent.active = this.controlMode;

    this._pressedQueue.clear();
    this._releasedQueue.clear();
  }

  dispose() {
    this.releaseAll();
    this.events.clear();
    this.sources.clear();
  }
}
