/**
 * Original LAST ZONE island content layout.
 *
 * Coordinates are metres in the X/Z plane. This is intentionally hand-authored
 * world data (not ten copies of one prefab): the procedural builders below use
 * each POI's theme and footprint to place its own structures, landmarks, cover,
 * roads and future drop/loot anchors.
 */
export const POI_DEFINITIONS = Object.freeze([
  {
    id: 'central-city', name: 'Central City', theme: 'urban', landmark: 'Crownline Tower',
    center: [0, 0], radius: 245, flattenRadius: 132, density: 'dense',
  },
  {
    id: 'industrial-yard', name: 'Industrial Yard', theme: 'industrial', landmark: 'Kilnstack Chimney',
    center: [-650, -500], radius: 210, flattenRadius: 112, density: 'medium',
  },
  {
    id: 'military-base', name: 'Military Base', theme: 'military', landmark: 'Northwatch Mast',
    center: [1050, -250], radius: 225, flattenRadius: 128, density: 'medium',
  },
  {
    id: 'harbor', name: 'Harbor', theme: 'harbor', landmark: 'Tidebreaker Crane',
    center: [-1720, 620], radius: 205, flattenRadius: 112, density: 'medium',
  },
  {
    id: 'riverside-town', name: 'Riverside Town', theme: 'riverside', landmark: 'Willow Water Tower',
    center: [-620, 710], radius: 195, flattenRadius: 108, density: 'medium',
  },
  {
    id: 'hilltop-village', name: 'Hilltop Village', theme: 'hilltop', landmark: 'Beacon Chapel',
    center: [880, 1040], radius: 195, flattenRadius: 108, density: 'sparse',
  },
  {
    id: 'forest-camp', name: 'Forest Camp', theme: 'forest', landmark: 'Pinewatch Lookout',
    center: [-1020, -900], radius: 180, flattenRadius: 94, density: 'sparse',
  },
  {
    id: 'power-station', name: 'Power Station', theme: 'power', landmark: 'Twin Flue Stack',
    center: [420, -1230], radius: 210, flattenRadius: 116, density: 'medium',
  },
  {
    id: 'quarry', name: 'Quarry', theme: 'quarry', landmark: 'Redcut Gantry',
    center: [1340, 620], radius: 225, flattenRadius: 122, density: 'sparse',
  },
  {
    id: 'farm-valley', name: 'Farm Valley', theme: 'farm', landmark: 'Windward Mill',
    center: [-420, -1390], radius: 215, flattenRadius: 126, density: 'medium',
  },
]);

/** Road center lines are deliberately routed through valleys and town edges. */
export const ROAD_NETWORK = Object.freeze([
  {
    id: 'island-spine-west', type: 'main', width: 15,
    points: [[-1820, 500], [-1720, 620], [-1515, 500], [-1390, 540], [-1190, 420], [-900, 430], [-620, 710], [-520, 535], [-280, 390], [0, 0]],
  },
  {
    id: 'island-spine-east', type: 'main', width: 15,
    points: [[0, 0], [300, 430], [610, 740], [880, 1040], [1190, 850], [1340, 620], [1470, 300], [1370, 20], [1050, -250]],
  },
  {
    id: 'southern-route', type: 'main', width: 13,
    points: [[1050, -250], [760, -620], [600, -900], [420, -1230], [0, -1380], [-420, -1390], [-650, -1100], [-650, -500], [-400, -300], [-250, -140], [0, 0]],
  },
  {
    id: 'harbor-road', type: 'secondary', width: 8,
    points: [[-1820, 500], [-1710, 300], [-1470, 170], [-1130, 80], [-900, -80], [-650, -500]],
  },
  {
    id: 'river-market-road', type: 'secondary', width: 8,
    points: [[-620, 710], [-410, 850], [-180, 620], [0, 0], [250, -145], [440, -360], [1050, -250]],
  },
  {
    id: 'quarry-track', type: 'dirt', width: 6,
    points: [[1340, 620], [1510, 1040], [1330, 1330], [930, 1440], [650, 1360], [880, 1040]],
  },
  {
    id: 'forest-track', type: 'dirt', width: 6,
    points: [[-1020, -900], [-1280, -1120], [-1510, -980], [-1600, -700], [-1370, -410], [-1020, -360], [-650, -250]],
  },
]);

/** River cuts from the eastern highlands past Riverside Town and out to Harbor. */
export const RIVER_PATH = Object.freeze([
  [1500, -1120], [1260, -870], [990, -660], [720, -500], [420, -300],
  [280, -350], [300, 200], [-270, 385], [-520, 535], [-800, 615],
  [-1080, 615], [-1320, 565], [-1515, 500], [-1690, 500], [-1840, 500],
]);

export const MOUNTAIN_RANGES = Object.freeze([
  { id: 'west-spine', center: [-870, -900], radius: 350, height: 168 },
  { id: 'eastern-crown', center: [610, -1050], radius: 380, height: 205 },
  { id: 'quarry-ridge', center: [1320, 920], radius: 330, height: 154 },
  { id: 'north-shoulder', center: [180, 1320], radius: 280, height: 126 },
  { id: 'southwestern-ridge', center: [-1200, -250], radius: 280, height: 116 },
]);

/** Broad forest masses; Nature scatters trees inside these regions, not uniformly. */
export const FOREST_PATCHES = Object.freeze([
  { center: [-1050, -900], radius: 430 },
  { center: [-1260, -380], radius: 310 },
  { center: [580, 1330], radius: 330 },
  { center: [1490, -580], radius: 280 },
  { center: [-60, 1040], radius: 290 },
]);

/** Roadside river crossings. The visible decks and approaches are real colliders. */
export const BRIDGE_SITES = Object.freeze([
  { id: 'willow-span', center: [-520, 535], yaw: -0.55, length: 64, width: 15 },
  { id: 'east-ford', center: [720, -500], yaw: -0.55, length: 64, width: 13 },
  { id: 'harbor-crossing', center: [-1690, 500], yaw: 0.22, length: 64, width: 12 },
]);

/** Future match-drop prep only; no aircraft, parachute, loot or spawning loop. */
export const INITIAL_DROP_REGIONS = Object.freeze(
  POI_DEFINITIONS.map((poi) => ({
    id: poi.id,
    name: poi.name,
    center: poi.center,
    radius: Math.max(100, poi.radius * 0.68),
    candidateCount: 12,
  })),
);
