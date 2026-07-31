const fs = require('fs');
const path = require('path');

const furnitureDir = path.join(__dirname, 'webview-ui/public/assets/furniture');

const dirs = fs.readdirSync(furnitureDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let updated = 0;

for (const dir of dirs) {
  const manifestPath = path.join(furnitureDir, dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    let isDesk = false;
    let category = "misc";
    
    const id = data.id.toUpperCase();
    
    if (id.includes('DESK') || id.includes('TABLE') || id.includes('COUNTER') || id.includes('WORKBENCH')) {
      category = "desks";
      if (id.includes('DESK') || id.includes('WORKBENCH')) isDesk = true;
    } else if (id.includes('CHAIR') || id.includes('SOFA') || id.includes('STOOL') || id.includes('BENCH') || id.includes('BEAN_BAG')) {
      category = "chairs";
    } else if (id.includes('CABINET') || id.includes('BOOKSHELF') || id.includes('REFRIGERATOR')) {
      category = "storage";
    } else if (id.includes('PC') || id.includes('PRINTER') || id.includes('MACHINE') || id.includes('SCREEN')) {
      category = "electronics";
    } else if (id.includes('PLANT') || id.includes('CACTUS') || id.includes('PAINTING') || id.includes('BOARD') || id.includes('BIN') || id.includes('CLOCK')) {
      category = "decor";
    }
    
    data.category = category;
    
    fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2));
    updated++;
  }
}

console.log(`Updated ${updated} manifests with category fields.`);
