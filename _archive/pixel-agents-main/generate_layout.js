const fs = require('fs');
const path = require('path');

const layoutPath = path.join(__dirname, 'webview-ui/public/assets/default-layout-1.json');

const cols = 40;
const rows = 26;
const tiles = [];
const tileColors = [];

// Exact colors from the original layout
const PALETTE = {
  WOOD: { h: 25, s: 48, b: -43, c: -88, colorize: false },
  BLUE: { h: 209, s: 39, b: -25, c: -80, colorize: false },
  CHECKER: { h: 0, s: 0, b: 0, c: 0, colorize: false },
  GRAY: { h: 209, s: 0, b: -16, c: -8, colorize: false },
  WALL: { h: 214, s: 30, b: -100, c: -55 }
};

for (let i = 0; i < cols * rows; i++) {
  const x = i % cols;
  const y = Math.floor(i / cols);

  let tile = 1;
  let color = PALETTE.GRAY;

  if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
    tile = 0; color = PALETTE.WALL;
  } else if (x > 0 && x < 15 && y > 0 && y < 20) {
    tile = 2; color = PALETTE.WOOD;
  } else if (x >= 15 && x < 26 && y > 0 && y < 14) {
    tile = 3; color = PALETTE.BLUE;
  } else if (x >= 15 && x < 26 && y >= 14 && y < 20) {
    tile = 8; color = PALETTE.CHECKER;
  } else if (x >= 26 && x < cols - 1 && y > 0 && y < rows - 1) {
    tile = 1; color = PALETTE.GRAY;
  } else if (y >= 20 && y < rows - 1) {
    tile = 1; color = PALETTE.GRAY;
  }

  // Draw Internal Walls
  if (x === 15 && y > 0 && y < 20) {
    if (y < 9 || y > 11) { tile = 0; color = PALETTE.WALL; }
  }
  if (y === 14 && x > 15 && x < 26) {
    if (x < 19 || x > 21) { tile = 0; color = PALETTE.WALL; }
  }
  if (x === 26 && y > 0 && y < 20) {
    if (y < 6 || y > 14) { tile = 0; color = PALETTE.WALL; }
  }
  if (y === 20 && x > 0 && x < 26) {
    if ((x > 5 && x < 9) || (x > 18 && x < 22)) { } 
    else { tile = 0; color = PALETTE.WALL; }
  }

  tiles.push(tile);
  tileColors.push(color);
}

// User-provided furniture array
const furniture = [
    { "uid": "prod_wall_01", "type": "DOUBLE_BOOKSHELF", "col": 2, "row": 1, "orientation": "front" },
    { "uid": "prod_wall_02", "type": "CLOCK", "col": 5, "row": 1, "orientation": "front" },
    { "uid": "prod_wall_03", "type": "DOUBLE_BOOKSHELF", "col": 8, "row": 1, "orientation": "front" },
    
    { "uid": "prod_desk_01", "type": "DESK_FRONT", "col": 2, "row": 4, "orientation": "front" },
    { "uid": "prod_pc_01", "type": "PC_FRONT_OFF", "col": 3, "row": 4, "orientation": "front" },
    { "uid": "prod_chair_01", "type": "WOODEN_CHAIR_FRONT", "col": 3, "row": 6, "orientation": "front" },
    { "uid": "prod_coffee_01", "type": "COFFEE", "col": 4, "row": 4, "orientation": "front" },

    { "uid": "prod_desk_02", "type": "DESK_FRONT", "col": 9, "row": 4, "orientation": "front" },
    { "uid": "prod_pc_02", "type": "PC_FRONT_OFF", "col": 10, "row": 4, "orientation": "front" },
    { "uid": "prod_chair_02", "type": "WOODEN_CHAIR_FRONT", "col": 10, "row": 6, "orientation": "front" },

    { "uid": "prod_desk_03", "type": "DESK_FRONT", "col": 3, "row": 12, "orientation": "front" },
    { "uid": "prod_pc_03", "type": "PC_FRONT_OFF", "col": 4, "row": 12, "orientation": "front" },
    { "uid": "prod_chair_03", "type": "WOODEN_CHAIR_FRONT", "col": 4, "row": 14, "orientation": "front" },

    { "uid": "prod_desk_04", "type": "DESK_FRONT", "col": 8, "row": 12, "orientation": "front" },
    { "uid": "prod_pc_04", "type": "PC_FRONT_OFF", "col": 9, "row": 12, "orientation": "front" },
    { "uid": "prod_chair_04", "type": "WOODEN_CHAIR_FRONT", "col": 9, "row": 14, "orientation": "front" },

    { "uid": "prod_desk_05", "type": "DESK_FRONT", "col": 3, "row": 17, "orientation": "front" },
    { "uid": "prod_pc_05", "type": "PC_FRONT_OFF", "col": 4, "row": 17, "orientation": "front" },
    { "uid": "prod_chair_05", "type": "WOODEN_CHAIR_BACK", "col": 4, "row": 16, "orientation": "back" },

    { "uid": "prod_desk_06", "type": "DESK_FRONT", "col": 8, "row": 17, "orientation": "front" },
    { "uid": "prod_pc_06", "type": "PC_FRONT_OFF", "col": 9, "row": 17, "orientation": "front" },
    { "uid": "prod_chair_06", "type": "WOODEN_CHAIR_BACK", "col": 9, "row": 16, "orientation": "back" },

    { "uid": "prod_decor_01", "type": "PLANT_2", "col": 1, "row": 3, "orientation": "front" },
    { "uid": "prod_decor_02", "type": "PLANT_2", "col": 13, "row": 3, "orientation": "front" },
    { "uid": "prod_decor_03", "type": "LARGE_PLANT", "col": 1, "row": 21, "orientation": "front" },
    { "uid": "prod_decor_04", "type": "BIN", "col": 13, "row": 22, "orientation": "front" },

    { "uid": "lounge_wall_01", "type": "SMALL_PAINTING", "col": 17, "row": 1, "orientation": "front" },
    { "uid": "lounge_wall_02", "type": "LARGE_PAINTING", "col": 19, "row": 1, "orientation": "front" },
    { "uid": "lounge_wall_03", "type": "SMALL_PAINTING_2", "col": 22, "row": 1, "orientation": "front" },
    { "uid": "lounge_plant_01", "type": "PLANT", "col": 16, "row": 2, "orientation": "front" },
    { "uid": "lounge_plant_02", "type": "PLANT", "col": 24, "row": 2, "orientation": "front" },

    { "uid": "lounge_sofa_01", "type": "SOFA_FRONT", "col": 19, "row": 5, "orientation": "front" },
    { "uid": "lounge_sofa_02", "type": "SOFA_BACK", "col": 19, "row": 9, "orientation": "back" },
    { "uid": "lounge_sofa_03", "type": "SOFA_SIDE", "col": 17, "row": 6, "orientation": "side" },
    { "uid": "lounge_sofa_04", "type": "SOFA_SIDE", "col": 22, "row": 6, "orientation": "side" },
    { "uid": "lounge_table", "type": "COFFEE_TABLE", "col": 19, "row": 7, "orientation": "front" },
    { "uid": "lounge_coffee", "type": "COFFEE", "col": 19, "row": 7, "orientation": "front" },

    { "uid": "mkt_wall_wb01", "type": "WHITEBOARD", "col": 31, "row": 1, "orientation": "front" },
    { "uid": "mkt_wall_bk01", "type": "BOOKSHELF", "col": 35, "row": 1, "orientation": "front" },

    { "uid": "mkt_desk_01", "type": "DESK_FRONT", "col": 27, "row": 4, "orientation": "front" },
    { "uid": "mkt_pc_01", "type": "PC_FRONT_ON_1", "col": 28, "row": 4, "orientation": "front" },
    { "uid": "mkt_chair_01", "type": "CUSHIONED_CHAIR_FRONT", "col": 28, "row": 6, "orientation": "front" },

    { "uid": "mkt_desk_02", "type": "DESK_FRONT", "col": 31, "row": 4, "orientation": "front" },
    { "uid": "mkt_pc_02", "type": "PC_FRONT_ON_2", "col": 32, "row": 4, "orientation": "front" },
    { "uid": "mkt_chair_02", "type": "CUSHIONED_CHAIR_FRONT", "col": 32, "row": 6, "orientation": "front" },

    { "uid": "mkt_desk_03", "type": "DESK_FRONT", "col": 35, "row": 4, "orientation": "front" },
    { "uid": "mkt_pc_03", "type": "PC_FRONT_ON_3", "col": 36, "row": 4, "orientation": "front" },
    { "uid": "mkt_chair_03", "type": "CUSHIONED_CHAIR_FRONT", "col": 36, "row": 6, "orientation": "front" },

    { "uid": "mkt_desk_side_01", "type": "DESK_SIDE", "col": 27, "row": 9, "orientation": "side" },
    { "uid": "mkt_pc_side_01", "type": "PC_SIDE", "col": 27, "row": 10, "orientation": "side" },
    { "uid": "mkt_chair_side_01", "type": "CUSHIONED_CHAIR_SIDE", "col": 26, "row": 10, "orientation": "side" },

    { "uid": "mkt_desk_side_02", "type": "DESK_SIDE", "col": 31, "row": 9, "orientation": "side" },
    { "uid": "mkt_pc_side_02", "type": "PC_SIDE", "col": 31, "row": 10, "orientation": "side" },
    { "uid": "mkt_chair_side_02", "type": "CUSHIONED_CHAIR_SIDE", "col": 30, "row": 10, "orientation": "side" },

    { "uid": "mkt_desk_04", "type": "DESK_FRONT", "col": 34, "row": 10, "orientation": "front" },
    { "uid": "mkt_pc_04", "type": "PC_FRONT_ON_1", "col": 35, "row": 10, "orientation": "front" },
    { "uid": "mkt_chair_04", "type": "CUSHIONED_CHAIR_FRONT", "col": 35, "row": 12, "orientation": "front" },

    { "uid": "mkt_desk_05", "type": "DESK_FRONT", "col": 27, "row": 15, "orientation": "front" },
    { "uid": "mkt_pc_05", "type": "PC_FRONT_OFF", "col": 28, "row": 15, "orientation": "front" },
    { "uid": "mkt_chair_05", "type": "CUSHIONED_CHAIR_FRONT", "col": 28, "row": 17, "orientation": "front" },

    { "uid": "mkt_desk_06", "type": "DESK_FRONT", "col": 31, "row": 15, "orientation": "front" },
    { "uid": "mkt_pc_06", "type": "PC_FRONT_ON_2", "col": 32, "row": 15, "orientation": "front" },
    { "uid": "mkt_chair_06", "type": "CUSHIONED_CHAIR_FRONT", "col": 32, "row": 17, "orientation": "front" },

    { "uid": "mkt_desk_07", "type": "DESK_FRONT", "col": 35, "row": 15, "orientation": "front" },
    { "uid": "mkt_pc_07", "type": "PC_FRONT_ON_3", "col": 36, "row": 15, "orientation": "front" },
    { "uid": "mkt_chair_07", "type": "CUSHIONED_CHAIR_FRONT", "col": 36, "row": 17, "orientation": "front" },

    { "uid": "mkt_wb_side", "type": "WHITEBOARD", "col": 38, "row": 10, "orientation": "front" },
    { "uid": "mkt_corner_table", "type": "SMALL_TABLE_FRONT", "col": 35, "row": 21, "orientation": "front" },
    { "uid": "mkt_corner_ch01", "type": "CUSHIONED_CHAIR_BACK", "col": 35, "row": 23, "orientation": "back" },
    { "uid": "mkt_corner_ch02", "type": "CUSHIONED_CHAIR_BACK", "col": 36, "row": 23, "orientation": "back" },

    { "uid": "mkt_plant_01", "type": "PLANT_2", "col": 27, "row": 2, "orientation": "front" },
    { "uid": "mkt_plant_02", "type": "PLANT_2", "col": 38, "row": 2, "orientation": "front" },
    { "uid": "mkt_plant_03", "type": "LARGE_PLANT", "col": 38, "row": 20, "orientation": "front" },
    { "uid": "mkt_bin", "type": "BIN", "col": 38, "row": 23, "orientation": "front" }
  ];

const layoutJson = {
  version: 1, cols, rows, tiles, tileColors, furniture,
  carpetTiles: Array(cols * rows).fill(null),
  areaTiles: Array(cols * rows).fill(null),
  areas: [], pets: [], npcs: []
};

fs.writeFileSync(layoutPath, JSON.stringify(layoutJson, null, 2));
console.log('AI-Generated Furniture applied to Layout!');
