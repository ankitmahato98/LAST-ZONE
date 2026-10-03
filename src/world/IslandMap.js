import * as THREE from 'three';
import { BoxBlocker, CircleBlocker } from '../physics/Collider.js';
import { Random } from '../utils/rng.js';
import { getMaterial } from './materials.js';
import {
  BRIDGE_SITES,
  POI_DEFINITIONS,
  RIVER_PATH,
  ROAD_NETWORK,
} from './MapData.js';

const THEMES = {
  urban: { count: 12, wall: 'brickWarm', roof: 'roofSlate', trim: 'concreteDark', window: 'windowGlass', radius: 158, landmark: 'tower', landmarkOffset: [0, -42] },
  industrial: { count: 8, wall: 'metalPainted', roof: 'roofMetal', trim: 'metal', window: 'windowGlass', radius: 140, landmark: 'chimney', landmarkOffset: [20, 0] },
  military: { count: 8, wall: 'concreteDark', roof: 'roofOlive', trim: 'metal', window: 'windowGlass', radius: 150, landmark: 'mast', landmarkOffset: [0, 28] },
  harbor: { count: 7, wall: 'harborWood', roof: 'roofRed', trim: 'metal', window: 'windowGlass', radius: 132, landmark: 'crane', landmarkOffset: [38, -8] },
  riverside: { count: 8, wall: 'stuccoCream', roof: 'roofRed', trim: 'woodDark', window: 'windowGlass', radius: 126, landmark: 'watertower', landmarkOffset: [-5, -28] },
  hilltop: { count: 7, wall: 'stoneWarm', roof: 'roofSlate', trim: 'concreteDark', window: 'windowGlass', radius: 126, landmark: 'chapel', landmarkOffset: [0, 0] },
  forest: { count: 6, wall: 'forestTimber', roof: 'roofForest', trim: 'woodDark', window: 'windowGlass', radius: 116, landmark: 'lookout', landmarkOffset: [-18, 16] },
  power: { count: 7, wall: 'concreteDark', roof: 'roofMetal', trim: 'metal', window: 'windowGlass', radius: 140, landmark: 'stacks', landmarkOffset: [0, 24] },
  quarry: { count: 6, wall: 'stoneCool', roof: 'roofMetal', trim: 'metal', window: 'windowGlass', radius: 154, landmark: 'gantry', landmarkOffset: [18, -22] },
  farm: { count: 8, wall: 'stuccoOchre', roof: 'roofRed', trim: 'woodDark', window: 'windowGlass', radius: 148, landmark: 'windmill', landmarkOffset: [18, 18] },
};

/**
 * Static island art and collision: enterable POI buildings, landmark silhouettes,
 * tactical cover, drivable-looking roads, a carved stream, bridges and ocean.
 * Repeated geometry is batched into InstancedMeshes by shared material/shape.
 */
export class IslandMap {
  constructor({ terrain, quality }) {
    this.name = 'island-map';
    this.terrain = terrain;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'island-content';
    this.boxes = [];
    this.cylinders = [];
    this.batches = new Map();
    this.buildingCount = 0;
    this.coverCount = 0;
    this.landmarkCount = 0;
    this.poiCatalog = POI_DEFINITIONS.map((poi) => ({
      ...poi,
      center: { x: poi.center[0], z: poi.center[1] },
      landmarkName: poi.landmark,
      theme: poi.theme,
      structureCount: 0,
    }));
    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false),
      cone: new THREE.ConeGeometry(0.5, 1, 12),
      gable: createGableRoofGeometry(),
    };
  }

  build() {
    this._buildOcean();
    this._buildPOIs();
    this._buildRoadNetwork();
    this._buildRiver();
    this._buildBridges();
    this._finalizeBatches();
    return this;
  }

  _buildOcean() {
    const size = this.terrain.size * 1.62;
    const segments = this.quality.terrainSegments > 200 ? 88 : 56;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = -position.getY(i);
      position.setZ(i, Math.sin(x * 0.0031 + z * 0.0018) * 0.07 + Math.cos(z * 0.0024 - x * 0.001) * 0.045);
    }
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    const ocean = new THREE.Mesh(geometry, getMaterial('ocean'));
    ocean.name = 'surrounding-ocean';
    ocean.position.y = this.terrain.config.seaLevel;
    ocean.receiveShadow = false;
    ocean.castShadow = false;
    ocean.frustumCulled = true;
    this.group.add(ocean);
    this.terrain.waterMesh = ocean;
  }

  _buildPOIs() {
    for (let poiIndex = 0; poiIndex < POI_DEFINITIONS.length; poiIndex += 1) {
      const poi = POI_DEFINITIONS[poiIndex];
      const catalog = this.poiCatalog[poiIndex];
      const theme = THEMES[poi.theme];
      const random = new Random(`${this.terrain.seed}:poi:${poi.id}`);
      const buildingAnchors = [];

      for (let i = 0; i < theme.count; i += 1) {
        const angle = (i / theme.count) * Math.PI * 2 + random.range(-0.11, 0.11);
        const band = [0.42, 0.66, 0.88][i % 3];
        const radius = Math.min(theme.radius, poi.radius - 42) * band + random.range(-5, 5);
        const x = poi.center[0] + Math.cos(angle) * radius;
        const z = poi.center[1] + Math.sin(angle) * radius;
        if (!this.terrain.isLandAt(x, z, 9)) continue;

        const width = random.range(poi.theme === 'urban' ? 13 : 10, poi.theme === 'urban' ? 19 : 16);
        const depth = random.range(10, poi.theme === 'industrial' || poi.theme === 'power' ? 21 : 16);
        const height = random.range(poi.theme === 'urban' ? 6.8 : 4.1, poi.theme === 'urban' ? 12.2 : 8.8);
        const yaw = angle + Math.PI * 0.5 + random.range(-0.35, 0.35);
        const roof = random.chance(poi.theme === 'industrial' || poi.theme === 'power' ? 0.28 : 0.62)
          ? 'gable'
          : 'flat';
        const groundY = this.terrain.heightAt(x, z);
        this._buildEnterableBuilding({
          poi,
          theme,
          center: { x, z },
          groundY,
          width,
          depth,
          height,
          yaw,
          roof,
          index: i,
        });
        buildingAnchors.push({ x, z, yaw, width, depth });
        catalog.structureCount += 1;
      }

      this.buildingCount += catalog.structureCount;
      this._buildPOIWalkways(poi, buildingAnchors);
      this._buildCover(poi, random);
      this._buildLandmark(poi, theme);
    }
  }

  _buildEnterableBuilding({ poi, theme, center, groundY, width, depth, height, yaw, roof, index }) {
    const wall = 0.34;
    const doorWidth = Math.min(2.0, width * 0.22);
    const doorHeight = Math.min(2.15, height * 0.63);
    const wallY = groundY + height / 2;
    const doorSegmentWidth = (width - doorWidth) / 2;
    const addWall = (lx, lz, size, wallName, y = wallY) => {
      const p = localToWorld(center, yaw, lx, lz);
      this._addBox({
        center: { x: p.x, y, z: p.z },
        size,
        yaw,
        material: theme.wall,
        name: `${poi.id}-${index}-${wallName}`,
      });
    };

    // Four collision walls, with a real doorway cut into the front wall.
    addWall(-width / 2 + doorSegmentWidth / 2, -depth / 2, [doorSegmentWidth, height, wall], 'front-left');
    addWall(width / 2 - doorSegmentWidth / 2, -depth / 2, [doorSegmentWidth, height, wall], 'front-right');
    if (height > doorHeight + 0.35) {
      addWall(0, -depth / 2, [doorWidth, height - doorHeight, wall], 'door-lintel', groundY + doorHeight + (height - doorHeight) / 2);
    }
    addWall(0, depth / 2, [width, height, wall], 'rear');
    addWall(-width / 2 + wall / 2, 0, [wall, height, depth], 'side-left');
    addWall(width / 2 - wall / 2, 0, [wall, height, depth], 'side-right');

    const wallCenter = localToWorld(center, yaw, 0, 0);
    if (roof === 'gable') {
      const roofHeight = Math.max(1.4, width * 0.13);
      this._addVisual({
        geometry: 'gable',
        material: theme.roof,
        position: { x: wallCenter.x, y: groundY + height, z: wallCenter.z },
        scale: [width + 1.2, roofHeight, depth + 0.8],
        yaw,
        castShadow: true,
      });
      // A simple roof volume stops both actors and shots passing through the roof.
      this.boxes.push(new BoxBlocker({
        center: { x: wallCenter.x, y: groundY + height + roofHeight / 2, z: wallCenter.z },
        size: { x: width + 0.8, y: roofHeight, z: depth + 0.6 },
        yaw,
        name: `${poi.id}-${index}-gable-roof`,
      }));
    } else {
      const roofY = groundY + height + 0.24;
      this._addBox({
        center: { x: wallCenter.x, y: roofY, z: wallCenter.z },
        size: [width + 0.8, 0.48, depth + 0.8],
        yaw,
        material: theme.roof,
        name: `${poi.id}-${index}-flat-roof`,
        walkable: true,
      });
      const parapetHeight = 0.48;
      const parapetY = roofY + 0.24 + parapetHeight / 2;
      for (const side of [-1, 1]) {
        const p = localToWorld(center, yaw, side * (width / 2), 0);
        this._addBox({
          center: { x: p.x, y: parapetY, z: p.z },
          size: [0.35, parapetHeight, depth + 0.8], yaw, material: theme.trim,
          name: `${poi.id}-${index}-roof-parapet`,
        });
      }
    }

    // An open doorway, dark inset, lintel and repeated windows read at gameplay distance.
    const doorCenter = localToWorld(center, yaw, 0, -depth / 2 - 0.035);
    this._addVisual({
      geometry: 'box', material: 'doorDark',
      position: { x: doorCenter.x, y: groundY + doorHeight * 0.46, z: doorCenter.z },
      scale: [doorWidth * 0.8, doorHeight * 0.9, 0.05], yaw, castShadow: false,
    });
    const windowY = groundY + height * 0.61;
    const windowWidth = Math.min(1.05, width * 0.095);
    const windowHeight = Math.min(0.82, height * 0.16);
    for (const side of [-1, 1]) {
      const p = localToWorld(center, yaw, side * width * 0.27, -depth / 2 - 0.025);
      this._addVisual({
        geometry: 'box', material: theme.window,
        position: { x: p.x, y: windowY, z: p.z },
        scale: [windowWidth, windowHeight, 0.035], yaw, castShadow: false,
      });
    }
    const awning = localToWorld(center, yaw, 0, -depth / 2 - 0.55);
    this._addVisual({
      geometry: 'box', material: theme.trim,
      position: { x: awning.x, y: groundY + doorHeight + 0.12, z: awning.z },
      scale: [doorWidth + 0.8, 0.18, 1.05], yaw, castShadow: true,
    });
  }

  _buildPOIWalkways(poi, buildings) {
    if (buildings.length < 4) return;
    const center = { x: poi.center[0], z: poi.center[1] };
    const points = [];
    for (let i = 0; i < buildings.length; i += 2) {
      const building = buildings[i];
      const entrance = localToWorld(
        { x: building.x, z: building.z },
        building.yaw,
        0,
        -building.depth * 0.5 - 3.5,
      );
      points.push([center.x, center.z], [entrance.x, entrance.z]);
    }
    const geometry = createConnectorGeometry(points, 2.8, this.terrain, 0.12);
    if (!geometry) return;
    const walkways = new THREE.Mesh(geometry, getMaterial(poi.theme === 'industrial' || poi.theme === 'quarry' ? 'dirtRoad' : 'footpath'));
    walkways.name = `${poi.id}-walkways`;
    walkways.receiveShadow = true;
    walkways.castShadow = false;
    this.group.add(walkways);
  }

  _buildCover(poi, random) {
    const coverCount = poi.theme === 'urban' ? 11 : 8;
    for (let i = 0; i < coverCount; i += 1) {
      const angle = (i / coverCount) * Math.PI * 2 + random.range(-0.2, 0.2);
      const radius = poi.radius * random.range(0.68, 0.9);
      const x = poi.center[0] + Math.cos(angle) * radius;
      const z = poi.center[1] + Math.sin(angle) * radius;
      if (!this.terrain.isLandAt(x, z, 8)) continue;
      const groundY = this.terrain.heightAt(x, z);
      const yaw = angle + Math.PI / 2;
      if (i % 3 === 0) {
        this._addBox({
          center: { x, y: groundY + 0.57, z },
          size: [2.2, 1.14, 1.8], yaw,
          material: poi.theme === 'military' || poi.theme === 'power' ? 'crateMetal' : 'crateWood',
          walkable: true,
          name: `${poi.id}-supply-crate-${i}`,
        });
      } else if (i % 3 === 1) {
        this._addBox({
          center: { x, y: groundY + 0.72, z },
          size: [5.2, 1.44, 0.78], yaw,
          material: poi.theme === 'harbor' || poi.theme === 'forest' ? 'woodDark' : 'sandbag',
          name: `${poi.id}-cover-wall-${i}`,
        });
      } else {
        this._addCylinder({
          x, z, y: groundY, radius: 0.62, height: 1.55,
          material: 'metal', name: `${poi.id}-barrel-${i}`,
        });
      }
      this.coverCount += 1;
    }
  }

  _buildLandmark(poi, theme) {
    const style = theme.landmark;
    const x = poi.center[0] + theme.landmarkOffset[0];
    const z = poi.center[1] + theme.landmarkOffset[1];
    const groundY = this.terrain.heightAt(x, z);
    const at = (lx, ly, lz) => ({ x: x + lx, y: groundY + ly, z: z + lz });
    this.landmarkCount += 1;

    if (style === 'tower') {
      this._landmarkBox(poi, at(0, 18, 0), [12, 36, 12], 'concreteDark', 'Crownline-Tower-base');
      this._landmarkBox(poi, at(0, 39, 0), [8.5, 7, 8.5], 'metalPainted', 'Crownline-Tower-crown');
      this._landmarkBox(poi, at(0, 44.2, 0), [10.5, 0.65, 10.5], 'roofSlate', 'Crownline-Tower-cap');
      for (const side of [-1, 1]) {
        this._addVisual({ geometry: 'box', material: 'windowGlass', position: at(side * 3.05, 20, -6.12), scale: [1.15, 27, 0.08], yaw: 0, castShadow: false });
      }
      return;
    }

    if (style === 'chimney' || style === 'stacks') {
      const count = style === 'stacks' ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const offsetX = count === 2 ? (i === 0 ? -6 : 6) : 0;
        const height = style === 'stacks' ? 32 : 37;
        this._addCylinder({ x: x + offsetX, z, y: groundY, radius: style === 'stacks' ? 2.25 : 2.7, height, material: 'chimneyBrick', name: `${poi.id}-stack` });
        this._addCylinder({ x: x + offsetX, z, y: groundY + height * 0.72, radius: style === 'stacks' ? 2.42 : 2.9, height: 1.25, material: 'warningRed', name: `${poi.id}-stack-band` });
        this._addCylinder({ x: x + offsetX, z, y: groundY + height - 1.8, radius: style === 'stacks' ? 2.68 : 3.15, height: 1.8, material: 'concreteDark', name: `${poi.id}-stack-crown` });
      }
      return;
    }

    if (style === 'mast') {
      this._addCylinder({ x, z, y: groundY, radius: 0.72, height: 29, material: 'metal', name: 'Northwatch-Mast' });
      for (const y of [8, 16, 24]) {
        this._addVisual({ geometry: 'box', material: 'warningRed', position: at(0, y, 0), scale: [4.8, 0.28, 0.28], yaw: 0, castShadow: false });
      }
      this._landmarkBox(poi, at(0, 29.5, 0), [3.5, 0.75, 3.5], 'warningRed', 'Northwatch-Mast-beacon');
      return;
    }

    if (style === 'crane') {
      const yaw = -0.26;
      for (const side of [-1, 1]) {
        const p = localToWorld({ x, z }, yaw, side * 5, 0);
        this._landmarkBox(poi, { x: p.x, y: groundY + 10, z: p.z }, [1.2, 20, 1.2], 'warningRed', 'Tidebreaker-Crane-leg', yaw);
      }
      this._landmarkBox(poi, at(0, 20, 0), [13, 1.4, 1.8], 'metal', 'Tidebreaker-Crane-crossbeam', yaw);
      this._landmarkBox(poi, at(-4.4, 27, 0), [2.3, 15, 2.2], 'warningRed', 'Tidebreaker-Crane-mast', yaw);
      this._landmarkBox(poi, at(4.5, 29, 0), [21, 1.2, 1.2], 'warningRed', 'Tidebreaker-Crane-boom', yaw);
      this._addVisual({ geometry: 'cylinder', material: 'metal', position: at(4.5, 19.5, 0), scale: [0.18, 18, 0.18], yaw: 0, castShadow: false });
      return;
    }

    if (style === 'watertower') {
      for (const dx of [-3.2, 3.2]) {
        for (const dz of [-3.2, 3.2]) {
          this._addCylinder({ x: x + dx, z: z + dz, y: groundY, radius: 0.35, height: 13, material: 'metal', name: 'Willow-Tower-leg' });
        }
      }
      this._addCylinder({ x, z, y: groundY + 12.2, radius: 4.6, height: 5.8, material: 'waterTank', name: 'Willow-Water-Tank' });
      this._addCylinder({ x, z, y: groundY + 15, radius: 4.8, height: 0.48, material: 'concreteDark', name: 'Willow-Tank-rim' });
      this._addVisual({ geometry: 'cone', material: 'roofRed', position: at(0, 16.9, 0), scale: [8.4, 2.6, 8.4], yaw: 0, castShadow: true });
      this.cylinders.push(new CircleBlocker({ x, z, y: groundY, radius: 4.8, height: 19, name: 'Willow-Water-Tower' }));
      return;
    }

    if (style === 'chapel') {
      this._landmarkBox(poi, at(0, 4, 0), [12, 8, 16], 'stoneWarm', 'Beacon-Chapel-nave');
      this._landmarkBox(poi, at(0, 10, -5.4), [5.5, 12, 5.5], 'stoneWarm', 'Beacon-Chapel-belfry');
      this._addVisual({ geometry: 'cone', material: 'roofSlate', position: at(0, 18.3, -5.4), scale: [7, 4.5, 7], yaw: 0, castShadow: true });
      this._landmarkBox(poi, at(0, 22, -5.4), [0.45, 4.5, 0.45], 'warningRed', 'Beacon-Chapel-spire');
      this._addVisual({ geometry: 'box', material: 'windowGlass', position: at(0, 4.4, -8.1), scale: [1.5, 2.4, 0.08], yaw: 0, castShadow: false });
      return;
    }

    if (style === 'lookout') {
      for (const dx of [-2.8, 2.8]) {
        for (const dz of [-2.8, 2.8]) {
          const p = { x: x + dx, z: z + dz };
          this._landmarkBox(poi, { x: p.x, y: groundY + 8.5, z: p.z }, [0.52, 17, 0.52], 'forestTimber', 'Pinewatch-Lookout-pile');
        }
      }
      for (const y of [7, 13]) {
        this._landmarkBox(poi, at(0, y, 0), [7.4, 0.6, 7.4], 'forestTimber', 'Pinewatch-Lookout-deck');
      }
      this._landmarkBox(poi, at(0, 16, 0), [5.4, 4.8, 5.4], 'forestTimber', 'Pinewatch-Lookout-cabin');
      this._addVisual({ geometry: 'gable', material: 'roofForest', position: at(0, 19.8, 0), scale: [6.4, 2.1, 6.4], yaw: 0, castShadow: true });
      this.cylinders.push(new CircleBlocker({ x, z, y: groundY, radius: 3.8, height: 20, name: 'Pinewatch-Lookout' }));
      return;
    }

    if (style === 'gantry') {
      const yaw = 0.22;
      for (const side of [-1, 1]) {
        const p = localToWorld({ x, z }, yaw, side * 12, 0);
        this._landmarkBox(poi, { x: p.x, y: groundY + 10, z: p.z }, [1.8, 20, 2.2], 'warningRed', 'Redcut-Gantry-leg', yaw);
      }
      this._landmarkBox(poi, at(0, 20, 0), [26, 2.2, 3], 'metal', 'Redcut-Gantry-beam', yaw);
      this._landmarkBox(poi, at(0, 23, 0), [5, 4.6, 4.5], 'warningRed', 'Redcut-Gantry-hoist', yaw);
      for (const side of [-1, 1]) {
        this._addVisual({ geometry: 'cylinder', material: 'metal', position: at(side * 7, 10, 0), scale: [0.24, 18, 0.24], yaw: 0, castShadow: false });
      }
      return;
    }

    if (style === 'windmill') {
      this._addCylinder({ x, z, y: groundY, radius: 3.1, height: 17, material: 'stuccoOchre', name: 'Windward-Mill-Tower' });
      this._addVisual({ geometry: 'cone', material: 'roofRed', position: at(0, 17.8, 0), scale: [6.8, 3.2, 6.8], yaw: 0, castShadow: true });
      const hub = at(0, 14.4, -3.2);
      this._addVisual({ geometry: 'cylinder', material: 'metal', position: hub, scale: [1.1, 0.85, 1.1], yaw: Math.PI / 2, castShadow: false });
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        this._addVisual({
          geometry: 'box', material: 'harborWood',
          position: { x: hub.x + Math.sin(angle) * 5, y: hub.y + Math.cos(angle) * 5, z: hub.z },
          scale: [0.52, 8.5, 0.36],
          rotation: [0, 0, -angle],
          castShadow: false,
        });
      }
      return;
    }
  }

  _landmarkBox(poi, center, size, material, suffix, yaw = 0) {
    this._addBox({ center, size, yaw, material, name: `${poi.id}-${suffix}` });
  }

  _buildRoadNetwork() {
    for (const road of ROAD_NETWORK) {
      const geometry = createRibbonGeometry(road.points, road.width, this.terrain, 0.18, 30);
      if (!geometry) continue;
      const material = road.type === 'dirt' ? getMaterial('dirtRoad') : getMaterial(road.type === 'main' ? 'mainRoad' : 'secondaryRoad');
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `road-${road.id}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
  }

  _buildRiver() {
    const geometry = createRiverRibbon(RIVER_PATH, this.terrain, this.terrain.config.riverHalfWidth * 1.72);
    const river = new THREE.Mesh(geometry, getMaterial('river'));
    river.name = 'willow-run-river';
    river.receiveShadow = false;
    river.castShadow = false;
    this.group.add(river);
  }

  _buildBridges() {
    for (const bridge of BRIDGE_SITES) {
      const [x, z] = bridge.center;
      const yaw = bridge.yaw;
      // Sample natural ground beyond the bridge ends, not in the cut channel,
      // so the deck and its ramps actually meet both valley banks.
      const bankOffset = bridge.length * 0.5 + 8;
      const a = localToWorld({ x, z }, yaw, 0, -bankOffset);
      const b = localToWorld({ x, z }, yaw, 0, bankOffset);
      const bankA = this.terrain.heightAt(a.x, a.z);
      const bankB = this.terrain.heightAt(b.x, b.z);
      const surface = this.terrain.riverSurfaceAt(x, z);
      const deckY = Math.max(surface + 1.7, Math.max(bankA, bankB) + 0.65);
      const deckCenter = { x, y: deckY - 0.38, z };

      this._addBox({
        center: deckCenter,
        size: [bridge.width, 0.76, bridge.length],
        yaw,
        material: bridge.id === 'willow-span' ? 'bridgeWood' : 'bridgeMetal',
        walkable: true,
        name: `bridge-${bridge.id}-deck`,
      });
      for (const side of [-1, 1]) {
        const p = localToWorld({ x, z }, yaw, side * (bridge.width * 0.5 - 0.3), 0);
        this._addBox({
          center: { x: p.x, y: deckY + 0.48, z: p.z },
          size: [0.34, 0.96, bridge.length],
          yaw,
          material: bridge.id === 'willow-span' ? 'woodDark' : 'metal',
          name: `bridge-${bridge.id}-rail`,
        });
      }
      for (const side of [-1, 1]) {
        const p = localToWorld({ x, z }, yaw, 0, side * (bridge.length * 0.28));
        const pierBottom = this.terrain.heightAt(p.x, p.z) - 0.5;
        this._addCylinder({
          x: p.x, z: p.z, y: pierBottom, radius: 0.72, height: Math.max(2, deckY - pierBottom),
          material: 'bridgeStone', name: `bridge-${bridge.id}-pier`,
        });
      }
      this._buildBridgeApproach({ x, z, yaw, length: bridge.length, width: bridge.width, deckY, bankA, bankB, id: bridge.id });
    }
  }

  _buildBridgeApproach({ x, z, yaw, length, width, deckY, bankA, bankB, id }) {
    const maxStepRise = 0.34;
    const stepDepth = 1.8;
    const end = length / 2;
    for (const side of [-1, 1]) {
      const bankY = side < 0 ? bankA : bankB;
      const rise = deckY - bankY;
      if (rise < 0.24 || rise > 14) continue;
      const stepCount = Math.max(5, Math.ceil(rise / maxStepRise));
      const stepHeight = Math.min(0.3, rise / stepCount);
      for (let i = 0; i < stepCount; i += 1) {
        // The lowest tread meets natural ground at the outer end; each step
        // rises toward the deck so both bridge approaches are walkable.
        const fraction = (stepCount - i) / stepCount;
        const top = bankY + rise * fraction;
        const depthOffset = end + (i + 0.5) * stepDepth;
        const p = localToWorld({ x, z }, yaw, 0, side * depthOffset);
        this._addBox({
          center: { x: p.x, y: top - stepHeight / 2, z: p.z },
          size: [width - 1.2, stepHeight, stepDepth + 0.04],
          yaw,
          material: id === 'willow-span' ? 'bridgeWood' : 'bridgeStone',
          walkable: true,
          name: `bridge-${id}-approach-step`,
        });
      }
    }
  }

  _addBox({ center, size, yaw = 0, material, name = 'island-box', walkable = false }) {
    this._addVisual({
      geometry: 'box', material,
      position: center,
      scale: Array.isArray(size) ? size : [size.x, size.y, size.z],
      yaw,
      castShadow: true,
    });
    this.boxes.push(new BoxBlocker({
      center,
      size: Array.isArray(size) ? { x: size[0], y: size[1], z: size[2] } : size,
      yaw,
      walkable,
      name,
    }));
  }

  _addCylinder({ x, z, y, radius, height, material, name = 'island-cylinder' }) {
    this._addVisual({
      geometry: 'cylinder', material,
      position: { x, y: y + height / 2, z },
      scale: [radius * 2, height, radius * 2],
      yaw: 0,
      castShadow: true,
    });
    this.cylinders.push(new CircleBlocker({ x, z, y, radius, height, name }));
  }

  _addVisual({ geometry = 'box', material, position, scale, yaw = 0, rotation = null, castShadow = true }) {
    const key = `${geometry}|${material}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { geometry, material, castShadow, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push({ position, scale, yaw, rotation, castShadow });
  }

  _finalizeBatches() {
    const dummy = new THREE.Object3D();
    for (const [key, batch] of this.batches) {
      const geometry = this.geometries[batch.geometry];
      const mesh = new THREE.InstancedMesh(geometry, getMaterial(batch.material), batch.instances.length);
      mesh.name = `static-batch-${key.replaceAll('|', '-')}`;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < batch.instances.length; i += 1) {
        const instance = batch.instances[i];
        dummy.position.set(instance.position.x, instance.position.y, instance.position.z);
        if (instance.rotation) {
          dummy.rotation.set(instance.rotation[0], instance.rotation[1], instance.rotation[2]);
        } else {
          dummy.rotation.set(0, instance.yaw ?? 0, 0);
        }
        dummy.scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  dispose() {
    this.group.traverse((child) => child.geometry?.dispose?.());
    this.group.clear();
    this.boxes.length = 0;
    this.cylinders.length = 0;
    this.poiCatalog.length = 0;
    this.batches.clear();
  }
}

function localToWorld(center, yaw, lx, lz) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: center.x + lx * cos - lz * sin,
    z: center.z + lx * sin + lz * cos,
  };
}

function createGableRoofGeometry() {
  const geometry = new THREE.BufferGeometry();
  const points = [
    // left roof slope
    [-0.5, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5], [-0.5, 0, 0.5],
    // right roof slope
    [0, 1, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [0, 1, 0.5],
    // front and rear gables
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5],
    [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, 1, 0.5],
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 6, 5, 4, 7, 6,
    8, 10, 9,
    11, 13, 12,
  ];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRibbonGeometry(points, width, terrain, heightOffset = 0.12, maxSegmentLength = 28) {
  const samples = samplePolyline(points, maxSegmentLength);
  return buildRibbonFromSamples(samples, width, (x, z) => terrain.heightAt(x, z) + heightOffset);
}

function createRiverRibbon(points, terrain, width) {
  const samples = samplePolyline(points, 12);
  return buildRibbonFromSamples(samples, width, (x, z) => terrain.riverSurfaceAt(x, z) + 0.08);
}

function createConnectorGeometry(flatPoints, width, terrain, heightOffset) {
  const paths = [];
  for (let i = 0; i + 1 < flatPoints.length; i += 2) paths.push([flatPoints[i], flatPoints[i + 1]]);
  const vertices = [];
  const indices = [];
  for (const path of paths) {
    const geometry = createRibbonGeometry(path, width, terrain, heightOffset, 18);
    if (!geometry) continue;
    const position = geometry.attributes.position;
    const base = vertices.length / 3;
    for (let i = 0; i < position.count; i += 1) vertices.push(position.getX(i), position.getY(i), position.getZ(i));
    for (const index of geometry.index.array) indices.push(base + index);
    geometry.dispose();
  }
  if (vertices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function samplePolyline(points, maxSegmentLength) {
  const samples = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / maxSegmentLength));
    for (let step = i === 0 ? 0 : 1; step <= count; step += 1) {
      const t = step / count;
      samples.push({ x: a[0] + dx * t, z: a[1] + dz * t });
    }
  }
  return samples;
}

function buildRibbonFromSamples(samples, width, heightAt) {
  if (samples.length < 2) return new THREE.BufferGeometry();
  const positions = new Float32Array(samples.length * 2 * 3);
  const uvs = new Float32Array(samples.length * 2 * 2);
  const indices = [];
  for (let i = 0; i < samples.length; i += 1) {
    const before = samples[Math.max(0, i - 1)];
    const after = samples[Math.min(samples.length - 1, i + 1)];
    let tx = after.x - before.x;
    let tz = after.z - before.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    const px = -tz * width * 0.5;
    const pz = tx * width * 0.5;
    const point = samples[i];
    const left = { x: point.x + px, z: point.z + pz };
    const right = { x: point.x - px, z: point.z - pz };
    const base = i * 6;
    positions[base] = left.x;
    positions[base + 1] = heightAt(left.x, left.z);
    positions[base + 2] = left.z;
    positions[base + 3] = right.x;
    positions[base + 4] = heightAt(right.x, right.z);
    positions[base + 5] = right.z;
    uvs[i * 4] = 0;
    uvs[i * 4 + 1] = i / (samples.length - 1);
    uvs[i * 4 + 2] = 1;
    uvs[i * 4 + 3] = i / (samples.length - 1);
    if (i < samples.length - 1) {
      const v = i * 2;
      indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
