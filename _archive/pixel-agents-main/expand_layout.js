const fs = require('fs');
const path = require('path');

const origLayoutPath = 'C:\\Users\\ADMIN\\Downloads\\temp_pixel_agents\\pixel-agents-main\\webview-ui\\public\\assets\\default-layout-1.json';
const newLayoutPath = path.join(__dirname, 'webview-ui/public/assets/default-layout-1.json');

const orig = JSON.parse(fs.readFileSync(origLayoutPath, 'utf8'));

const newCols = 40;
const newRows = 26;
const newTiles = new Array(newCols * newRows).fill(1); // Default floor
const newColors = new Array(newCols * newRows).fill(null);
const newCarpets = new Array(newCols * newRows).fill(null);
const newAreas = new Array(newCols * newRows).fill(null);

const DEFAULT_COLOR = { h: 220, s: 10, b: -5, c: 0, colorize: true };
const WALL_COLOR = null;

for (let i = 0; i < newTiles.length; i++) {
  newColors[i] = DEFAULT_COLOR;
}

// 1. Copy original 21x22 grid into top-left of the new 40x26 grid
for (let y = 0; y < orig.rows; y++) {
  for (let x = 0; x < orig.cols; x++) {
    const origIdx = y * orig.cols + x;
    const newIdx = y * newCols + x;
    
    newTiles[newIdx] = orig.tiles[origIdx];
    newColors[newIdx] = orig.tileColors[origIdx];
    newCarpets[newIdx] = orig.carpetTiles ? orig.carpetTiles[origIdx] : null;
    newAreas[newIdx] = orig.areaTiles ? orig.areaTiles[origIdx] : null;
  }
}

// 2. Build out the new expanded area boundaries
for (let y = 0; y < newRows; y++) {
  for (let x = 0; x < newCols; x++) {
    const idx = y * newCols + x;
    
    // Outer boundary walls for the new massive grid
    if (x === 0 || y === 0 || x === newCols - 1 || y === newRows - 1) {
      newTiles[idx] = 0; // WALL
      newColors[idx] = WALL_COLOR;
    }
    
    // The old right wall was at x=20. Let's make an opening in it to connect the rooms!
    if (x === 20 && y > 0 && y < 21) {
      if (y >= 8 && y <= 12) {
        // Break down the wall to make a huge corridor!
        newTiles[idx] = 1; 
        newColors[idx] = DEFAULT_COLOR;
      } else {
        newTiles[idx] = 0;
        newColors[idx] = WALL_COLOR;
      }
    }
    
    // The old bottom wall was at y=21. Make an opening!
    if (y === 21 && x > 0 && x < 20) {
      if (x >= 8 && x <= 12) {
        newTiles[idx] = 1;
        newColors[idx] = DEFAULT_COLOR;
      } else {
        newTiles[idx] = 0;
        newColors[idx] = WALL_COLOR;
      }
    }
  }
}

const furniture = [...orig.furniture];
let idCounter = 9000;

function addFurniture(assetId, x, y, opts = {}) {
  furniture.push({
    uid: `item_exp_${idCounter++}`,
    type: assetId,
    col: x,
    row: y,
    orientation: opts.orientation || 'front',
    ...opts
  });
}

// 3. Fill the new massive expanded right-side room (x: 22 to 38) with computers!
// This acts as a huge developer bullpen.
const bullpenCols = [23, 27, 31, 35];
const bullpenRows = [3, 7, 11, 15, 19];

for (let c of bullpenCols) {
  for (let r of bullpenRows) {
    addFurniture('DESK_FRONT', c, r);
    addFurniture('PC_FRONT_OFF', c + 1, r);
    addFurniture('WOODEN_CHAIR_FRONT', c + 1, r + 2); // Facing the desk
  }
}

// Add some water coolers and plants to the new area
addFurniture('PLANT_2', 22, 1);
addFurniture('PLANT_2', 38, 1);
addFurniture('LARGE_PLANT', 38, 24);
addFurniture('COFFEE', 38, 10);
addFurniture('BIN', 22, 24);

const expandedLayout = {
  version: 1,
  cols: newCols,
  rows: newRows,
  tiles: newTiles,
  tileColors: newColors,
  furniture: furniture,
  carpetTiles: newCarpets,
  areaTiles: newAreas,
  areas: orig.areas || [],
  pets: orig.pets || [],
  npcs: orig.npcs || []
};

fs.writeFileSync(newLayoutPath, JSON.stringify(expandedLayout, null, 2));
console.log('Expanded original layout successfully to 40x26.');
