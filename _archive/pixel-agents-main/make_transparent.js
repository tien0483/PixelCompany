const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const furnitureDir = path.join(__dirname, 'webview-ui/public/assets/furniture');

const dirs = fs.readdirSync(furnitureDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let updatedCount = 0;

function processPng(filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG({ filterType: 4 }))
      .on('parsed', function() {
        // Read top-left pixel (x=0, y=0)
        const bgR = this.data[0];
        const bgG = this.data[1];
        const bgB = this.data[2];
        const bgA = this.data[3];
        
        // If it's already transparent, skip
        if (bgA === 0) {
          resolve(false);
          return;
        }

        let changed = false;
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const idx = (this.width * y + x) << 2;
            const r = this.data[idx];
            const g = this.data[idx + 1];
            const b = this.data[idx + 2];
            
            // Tolerance check
            if (Math.abs(r - bgR) < 10 && Math.abs(g - bgG) < 10 && Math.abs(b - bgB) < 10) {
              this.data[idx + 3] = 0; // Set alpha to 0
              changed = true;
            }
          }
        }
        
        if (changed) {
          this.pack().pipe(fs.createWriteStream(filePath)).on('finish', () => resolve(true));
        } else {
          resolve(false);
        }
      })
      .on('error', reject);
  });
}

async function main() {
  for (const dir of dirs) {
    const pngPath = path.join(furnitureDir, dir, `${dir}.png`);
    if (fs.existsSync(pngPath)) {
      try {
        const changed = await processPng(pngPath);
        if (changed) {
          updatedCount++;
          console.log(`Made background transparent: ${dir}.png`);
        }
      } catch (err) {
        console.error(`Error processing ${dir}.png:`, err);
      }
    }
  }
  console.log(`Finished processing. Updated ${updatedCount} files.`);
}

main();
