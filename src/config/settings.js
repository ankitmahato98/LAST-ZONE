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
  fov: 68,
  fovSprintBoost: 6,
  near: 0.15,
  /** Long enough to reveal the island ridgelines; fog handles the far horizon. */
  far: 3200,
  shadows: true,
  /** Distance (world units) covered by the sun's shadow camera around the player. */
  shadowRadius: 68,
  /** Scene fog fades the 4 km island into the sea/sky horizon. */
  fogColor: 0xa8c4d8,
  fogNear: 720,
  fogFar: 2700,
};

export const QUALITY = {
  desktop: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    terrainSegments: 256,
    trees: 820,
    rocks: 260,
    grassTufts: 2600,
  },
  mobile: {
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    terrainSegments: 176,
    trees: 360,
    rocks: 130,
    grassTufts: 900,
  },
};

export const WORLD = {
  /** The full square heightfield, in metres; the playable island fills it. */
  size: 4600,
  seed: 'last-zone-01',
  /** Maximum broadphase range; the true boundary follows the irregular coast. */
  playableRadius: 2480,
};

export const TERRAIN = {
  seaLevel: 0,
  /** Main radius of a softly squared, irregular 4 km island coastline. */
  coastRadius: 1880,
  coastPower: 6,
  coastVariation: 54,
  beachWidth: 142,
  oceanShelfWidth: 190,
  oceanDepth: 30,
  beachElevation: 0.55,
  /** Hills and ridges use deterministic multi-scale noise plus hand-authored ranges. */
  broadScale: 0.00105,
  broadAmplitude: 94,
  hillScale: 0.0032,
  hillAmplitude: 34,
  detailScale: 0.014,
  detailAmplitude: 8,
  riverHalfWidth: 12,
  riverBankWidth: 35,
  riverDepth: 3.2,
  riverValleyStart: 26,
  riverValleyWidth: 210,
  riverValleyFloor: 8,
  poiBlendWidth: 76,
};

export const ARENA = {
  /** Slope limit shared by scenery and the existing training-target placement. */
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
  pivotHeight: 1.48,
  distance: 7.6,
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

export const HEALTH = {
  /** LOCKED (Phase B): the player has 200 HP. */
  playerMax: 200,
  /** Landing faster than this hurts; damage scales with the excess. */
  fallDamageSpeed: 17,
  fallDamagePerSpeed: 4.2,
  /** Brief entry protection on the one initial placement; never reapplied. */
  spawnProtection: 1.2,
};

/**
 * EP ("energy") - the second resource bar. LOCKED (Phase B):
 *
 *   max EP            300
 *   1 EP              1 HP
 *   conversion rate   1 EP per second, so 1 HP per second
 *   conversion stops  at 200 HP (or when EP runs out)
 *
 * EP never regenerates passively: it only comes from consumables, and it is
 * spent through an explicit conversion into HP - which is why EP can never act
 * as permanent extra maximum HP.
 */
export const EP = {
  max: 300,
  /** HP restored per EP spent. */
  hpPerEnergy: 1,
  /** EP spent per second while converting. */
  conversionRate: 1,
  /** Conversion is player-triggered (action `convert`), never automatic. */
  autoConvert: false,
};

/** Inventory layout: kept small and mobile friendly. */
export const INVENTORY = {
  /** Weapon slots (slot 0 is the primary). */
  weaponSlots: 2,
  /** Distinct consumable stacks the backpack holds. */
  consumableSlots: 4,
  /** Future containers - already wired so Phase C items need no rewrite. */
  armorSlots: 2,
  attachmentSlots: 4,
  cosmeticSlots: 2,
  /** Seconds a rejected action stays surfaced on the HUD. */
  refusalTime: 1.6,
};

/** World loot. */
export const LOOT = {
  /** How close the player must be for the interact action to work. */
  interactionRadius: 2.75,
  /** Distance a dropped item lands in front of the player. */
  dropDistance: 1.5,
  /** Extra instance slots per visual so drops never have to grow the scene. */
  dropHeadroom: 14,
  /** Hard cap on the pickups generated from map anchors. */
  maxPickups: 480,
  /** Spatial hash cell size (metres) for the nearest-pickup query. */
  cellSize: 24,
  /** Only pickups this close animate (saves instance writes on mobile). */
  animationRadius: 70,
  /** Seconds between idle bob updates. */
  animationInterval: 1 / 12,
  /** Radius of the guaranteed arrival-plaza starting kit. */
  stashRadius: 9.5,
  /** Drop the starting kit near the plaza center rather than in the ring. */
  spawnWeaponId: 'rifle',
};

export const COMBAT = {
  /** Hitscan range cap - longer than any weapon's own range. */
  maxRayDistance: 260,
  /** Damage falloff: full damage up to `falloffStart`, `minScale` at `falloffEnd`. */
  falloffStart: 45,
  falloffEnd: 140,
  minFalloffScale: 0.45,
  /** Recoil is applied to the camera and decays back. */
  maxRecoil: 0.09,
  recoilRecovery: 9,
  /** Visual feedback lifetimes (seconds). */
  tracerLifetime: 0.055,
  impactLifetime: 3.5,
  maxImpacts: 28,
  hitMarkerLifetime: 0.22,
  /** How long a destroyed target stays down before it is rebuilt. */
  targetRespawnDelay: 4,
  /** Aiming (ADS) behaviour for the third person camera + controller. */
  aim: {
    fovScale: 0.78,
    distanceScale: 0.6,
    shoulderOffset: 0.6,
    heightOffset: 0.12,
    moveSpeedScale: 0.45,
    spreadScale: 0.35,
    transitionLambda: 14,
  },
  /** Where the player may damage-test themselves from the debug overlay. */
  debugDamageAmount: 25,
};

/**
 * Weapon definitions.
 *
 * Adding a weapon is a data change: give it an id, ballistics and a `model`
 * (see combat/weapons/WeaponModels.js). The systems never special case a
 * weapon name - they read these fields.
 */
export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'AR-4 Ranger',
    /** 'hitscan' today; 'projectile' is a future `kind` with the same interface. */
    kind: 'hitscan',
    /** Ammo family: reloads draw from the matching inventory pool. */
    ammoType: '556',
    automatic: true,
    damage: 24,
    /** Damage multiplier for hits above `Damageable.headHeightFraction`. */
    headshotMultiplier: 2,
    /** Rounds per second. */
    fireRate: 8.5,
    magazineSize: 30,
    reserveAmmo: 210,
    reloadTime: 1.9,
    range: 180,
    /** Spread in radians: base by state, bloom added per shot. */
    spread: {
      standing: 0.011,
      moving: 0.032,
      aiming: 0.004,
      perShot: 0.006,
      max: 0.055,
      recovery: 3.2,
    },
    /** Per-shot camera kick (radians) and how fast it settles. */
    recoil: {
      vertical: 0.011,
      horizontal: 0.0045,
      recovery: 9,
    },
    /** Attach point for the model / muzzle effects, in character space. */
    muzzle: { x: 0.19, y: 1.29, z: -0.62 },
    model: 'rifle',
  },
};

export const TARGETS = {
  /** Combat-test dummies placed around the Central City arrival plaza. */
  count: 8,
  maxHealth: 100,
  radius: 0.45,
  height: 1.75,
  /** Where dummies may appear: a ring around the spawn pad. */
  radiusRange: [12, 26],
};

/** Action -> keyboard code(s). Touch/mouse feed the same actions. */
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  primary: ['KeyF'],
  aim: ['KeyQ'],
  reload: ['KeyR'],
  /** Pick up / swap the loot under the prompt. */
  interact: ['KeyE'],
  /** Switch between the two weapon slots. */
  swapWeapon: ['KeyX'],
  /** Drop the equipped weapon into the world. */
  dropWeapon: ['KeyG'],
  /** Start/stop the EP -> HP conversion. */
  convert: ['KeyC'],
  /** Quick-use consumable stacks, in pickup order. */
  useItem1: ['Digit1'],
  useItem2: ['Digit2'],
  useItem3: ['Digit3'],
  useItem4: ['Digit4'],
  hurtMe: ['KeyH'],
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
