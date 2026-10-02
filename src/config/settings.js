import { isCoarsePointer } from '../utils/dom.js';

/**
 * Central tuning table.
 *
 * Nothing in the game hard-codes a magic number: if you want the player to run
 * faster, the camera to feel snappier or the world to be smaller, change it
 * here. Later features (weapons, loot, zone timings) belong in this file too -
 * either as new top level sections or as `config` entries on a system.
 */

export const RENDER = {
  /** Hard cap on device pixel ratio - mobile GPUs choke above ~2x. */
  maxPixelRatio: 2,
  fov: 62,
  fovSprintBoost: 7,
  near: 0.15,
  far: 700,
  shadows: true,
  /** Distance (world units) covered by the sun's shadow camera around the player. */
  shadowRadius: 65,
  /** Scene fog. Fog colour is also used as the sky horizon colour. */
  fogColor: 0xa8c4d8,
  fogNear: 90,
  fogFar: 340,
};

export const QUALITY = {
  desktop: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    terrainSegments: 176,
    trees: 90,
    rocks: 120,
    grassTufts: 900,
  },
  mobile: {
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    terrainSegments: 112,
    trees: 45,
    rocks: 70,
    grassTufts: 0,
  },
};

export const WORLD = {
  /** Square world size in metres. The terrain mesh is `size x size`. */
  size: 420,
  seed: 'last-zone-01',
  /** Soft barrier: the player is pushed back before the mesh edge. */
  playableRadius: 185,
};

export const TERRAIN = {
  /** Radius around the origin that is kept flat so the arena is walkable. */
  flatRadius: 26,
  /** Distance over which the flat area blends into the noise hills. */
  blendRadius: 62,
  /** Max height of rolling hills (in metres). */
  hillAmplitude: 11,
  /** Base noise feature size. Bigger = wider, gentler hills. */
  hillScale: 0.0085,
  /** Ridge of mountains that visually closes the world off at the rim. */
  rimStart: 150,
  rimEnd: 215,
  rimHeight: 46,
  /** Detail noise added on top of the hills. */
  detailScale: 0.06,
  detailAmplitude: 0.35,
};

export const ARENA = {
  /** Props are scattered outside the flat centre, inside this radius. */
  scatterRadius: [34, 150],
  /** Minimum terrain slope (0..1) props avoid - nothing floats on cliffs. */
  maxSlope: 0.42,
};

export const PLAYER = {
  spawn: { x: 0, z: 6 },
  radius: 0.36,
  height: 1.8,
  eyeHeight: 1.5,
  walkSpeed: 5.2,
  sprintSpeed: 8.4,
  groundAcceleration: 46,
  airAcceleration: 10,
  groundFriction: 12,
  jumpSpeed: 7.2,
  gravity: 24,
  terminalVelocity: 60,
  /** Max ledge height the player can step or be snapped up onto. */
  stepHeight: 0.5,
  /**
   * Steepest terrain the player can walk up, as |gradient| (0.62 ~= 32 deg).
   * Steps are limited by `stepHeight`; continuous slopes by this. Without it a
   * character can climb a vertical wall one 0.17m step at a time.
   */
  maxSlope: 0.62,
  /** Grace window after leaving the ground in which a jump still counts. */
  coyoteTime: 0.1,
  /** Early jump presses are remembered for this long. */
  jumpBufferTime: 0.15,
  airControl: 0.35,
  /** How fast the character model turns to face the movement direction. */
  turnLambda: 14,
};

export const CAMERA = {
  /** Pivot sits slightly above the player's eye line. */
  pivotHeight: 1.55,
  distance: 6.2,
  minDistance: 2.2,
  maxDistance: 13,
  zoomStep: 0.9,
  minPitch: -55 * (Math.PI / 180),
  maxPitch: 62 * (Math.PI / 180),
  /** Sensitivity is in radians per pixel (mouse) / per touch pixel. */
  mouseSensitivity: 0.0026,
  touchSensitivity: 0.0055,
  keyboardLookSpeed: 1.9,
  invertY: false,
  /** Higher lambda = camera follows the player more tightly. */
  followLambda: 14,
  collisionPadding: 0.35,
  collisionSamples: 14,
  /** Minimum distance kept from blockers so the view never enters geometry. */
  minCollisionDistance: 1.15,
};

/** Action -> keyboard code(s). Touch/mouse feed the same actions. */
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  lookUp: ['KeyI'],
  lookDown: ['KeyK'],
  lookLeft: ['KeyJ'],
  lookRight: ['KeyL'],
  toggleDebug: ['F3'],
  toggleTouch: ['KeyT'],
};

/** Device capability heuristics. `?quality=mobile|desktop` forces a preset. */
export function detectProfile() {
  if (typeof window === 'undefined') return 'desktop';
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'mobile' || forced === 'desktop') return forced;

  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 620;
  return isCoarsePointer() || smallScreen ? 'mobile' : 'desktop';
}

export function getQualitySettings(profile = detectProfile()) {
  return { ...(QUALITY[profile] ?? QUALITY.desktop) };
}

/** Feature flags read from the URL, e.g. `?touch=1&debug=1`. */
export function getLaunchFlags() {
  if (typeof window === 'undefined') return { touch: false, debug: false, profile: 'desktop' };
  const params = new URLSearchParams(window.location.search);
  const profile = detectProfile();
  return {
    profile,
    touch: params.get('touch') === '1' || params.has('touch'),
    noTouch: params.get('touch') === '0',
    debug: params.get('debug') === '1',
  };
}
