const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'webview-ui/public/assets/furniture');

// List of assets extracted from the user's sprite sheet image
const assets = [
  { id: 'DESK_OFFICE_SIMPLE', w: 2, h: 1 },
  { id: 'CHAIR_OFFICE', w: 1, h: 1 },
  { id: 'PC_OFFICE_FRONT', w: 1, h: 1 },
  { id: 'PC_OFFICE_SIDE', w: 1, h: 1 },
  { id: 'STOOL_OFFICE', w: 1, h: 1 },
  { id: 'IT_WORKBENCH', w: 3, h: 1 },
  { id: 'FILING_CABINET', w: 1, h: 1 },
  { id: 'PRINTER_COPIER', w: 2, h: 1 },
  { id: 'PRINTER_DESKTOP', w: 1, h: 1 },
  { id: 'DOUBLE_BOOKSHELF', w: 2, h: 1 },
  { id: 'BIN_OFFICE', w: 1, h: 1 },
  { id: 'SOFA_SECTION_FRONT', w: 3, h: 1 },
  { id: 'SOFA_SECTION_SIDE', w: 1, h: 3 },
  { id: 'SOFA_SECTION_BACK', w: 3, h: 1 },
  { id: 'SOFA_SECTIONAL_L', w: 2, h: 2 },
  { id: 'SOFA_ARMCHAIR', w: 1, h: 1 },
  { id: 'BEAN_BAG', w: 1, h: 1 },
  { id: 'COFFEE_TABLE', w: 2, h: 1 },
  { id: 'ROUND_TABLE', w: 2, h: 2 },
  { id: 'ROUND_TABLE_CHAIR', w: 1, h: 1 },
  { id: 'TABLE_CONFERENCE_LARGE', w: 4, h: 2 },
  { id: 'CHAIR_CONFERENCE', w: 1, h: 1 },
  { id: 'DINING_TABLE', w: 2, h: 1 },
  { id: 'DINING_CHAIR', w: 1, h: 1 },
  { id: 'CUSHIONED_BENCH', w: 2, h: 1 },
  { id: 'SMALL_PAINTING', w: 1, h: 1 },
  { id: 'LARGE_PAINTING', w: 2, h: 1 },
  { id: 'PRESENTATION_BOARD', w: 1, h: 1 },
  { id: 'PRESENTATION_SCREEN', w: 3, h: 1 },
  { id: 'KITCHEN_COUNTER_BASE', w: 3, h: 1 },
  { id: 'COFFEE_MACHINE', w: 1, h: 1 },
  { id: 'KITCHEN_JAR_MUG_GROUP', w: 1, h: 1 },
  { id: 'REFRIGERATOR', w: 1, h: 1 },
  { id: 'CLOCK_DIGITAL', w: 1, h: 1 },
  { id: 'CLOCK_ANALOG', w: 1, h: 1 },
  { id: 'PLANT_TREE_LARGE', w: 1, h: 1 },
  { id: 'PLANT_TREE_SMALL', w: 1, h: 1 },
  { id: 'PLANT_HANGING', w: 1, h: 1 },
  { id: 'PLANT_DESKTOP', w: 1, h: 1 }
];

if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

assets.forEach(asset => {
  const folderPath = path.join(ASSETS_DIR, asset.id);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const manifest = {
    type: "asset",
    id: asset.id,
    file: `${asset.id}.png`,
    width: asset.w * 16,
    height: asset.h * 16 + 16, // Typical height accounts for 2D overlap
    footprintW: asset.w,
    footprintH: asset.h,
    orientation: "front",
    canPlaceOnWalls: asset.id.includes('PAINTING') || asset.id.includes('SCREEN') || asset.id.includes('CLOCK'),
    canPlaceOnSurfaces: asset.id.includes('DESKTOP') || asset.id.includes('MACHINE') || asset.id.includes('MUG') || asset.id.includes('PRINTER_DESKTOP'),
    backgroundTiles: 1
  };

  const manifestPath = path.join(folderPath, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Generated manifest for ${asset.id}`);
});

console.log('All manifests created successfully.');
