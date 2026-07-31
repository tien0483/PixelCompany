const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ZIP_FILE = "C:\\Users\\ADMIN\\Downloads\\sliced_office_sprites (2).zip";
const TMP_DIR = path.join(__dirname, 'tmp_sprites');
const ASSETS_DIR = path.join(__dirname, 'webview-ui/public/assets/furniture');

// Clean up and recreate tmp dir
if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Extract zip using tar
console.log('Extracting zip...');
execSync(`tar -xf "${ZIP_FILE}" -C "${TMP_DIR}"`);

const files = fs.readdirSync(TMP_DIR).filter(f => f.endsWith('.png'));
console.log(`Found ${files.length} png files.`);

files.forEach(file => {
  const id = path.basename(file, '.png');
  const srcPath = path.join(TMP_DIR, file);
  
  // Read PNG dimensions
  const buffer = Buffer.alloc(24);
  const fd = fs.openSync(srcPath, 'r');
  fs.readSync(fd, buffer, 0, 24, 0);
  fs.closeSync(fd);
  
  let width = buffer.readUInt32BE(16);
  let height = buffer.readUInt32BE(20);

  // Calculate footprint
  let footprintW = Math.max(1, Math.round(width / 16));
  // The height often includes overlap (e.g. 32px height for 1 footprint tile).
  let footprintH = Math.max(1, Math.round((height - 16) / 16));
  if (footprintH < 1) footprintH = 1;
  if (height === 16) footprintH = 1;

  // Create folder
  const folderPath = path.join(ASSETS_DIR, id);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Copy image
  fs.copyFileSync(srcPath, path.join(folderPath, file));

  // Generate manifest
  const canPlaceOnWalls = id.includes('PAINTING') || id.includes('SCREEN') || id.includes('CLOCK');
  const canPlaceOnSurfaces = id.includes('DESKTOP') || id.includes('MACHINE') || id.includes('MUG');

  const manifest = {
    type: "asset",
    id: id,
    file: file,
    width: width,
    height: height,
    footprintW: footprintW,
    footprintH: footprintH,
    orientation: "front",
    canPlaceOnWalls: canPlaceOnWalls,
    canPlaceOnSurfaces: canPlaceOnSurfaces,
    backgroundTiles: 1
  };

  fs.writeFileSync(path.join(folderPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Created asset: ${id} (${width}x${height}) => footprint ${footprintW}x${footprintH}`);
});

console.log('All assets imported and manifests created successfully.');
