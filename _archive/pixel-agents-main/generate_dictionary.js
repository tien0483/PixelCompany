const fs = require('fs');
const path = require('path');
const dir = 'webview-ui/public/assets/furniture';
const folders = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory());

let output = '# Pixel Office Furniture Asset Dictionary\n\n';
output += 'Here is the complete dictionary of all available furniture assets, their exact IDs required for the layout generator, and their footprint sizes (Width × Height in tiles).\n\n';
output += '### Crucial Layout Engine Rules:\n';
output += '- **Asset ID vs Group ID:** For groups (like DESK, PC, SOFA), you MUST use the exact asset ID of the specific state/orientation you want (e.g., `DESK_FRONT`, `PC_FRONT_OFF`, `SOFA_FRONT`). Do not use the group name.\n';
output += '- **Grid Boundaries:** The layout is 40 columns by 26 rows. Coordinates `(0,0)` to `(39,25)`.\n';
output += '- **Overlaps:** Furniture cannot overlap unless `canPlaceOnSurfaces` is true (e.g., PC on DESK). Ensure footprints fit within room boundaries.\n\n';

for (const folder of folders) {
  const manifestPath = path.join(dir, folder, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    output += `## ${data.name} (${data.id})\n\n`;
    if (data.type === 'group') {
      output += 'This is a **GROUP**. You must use one of the following specific Asset IDs to place it:\n\n';
      
      const processMembers = (members, statePrefix = '') => {
        for (const member of members) {
          if (member.type === 'asset') {
            output += `- **ID:** \`${member.id}\`\n`;
            output += `  - Footprint: ${member.footprintW}x${member.footprintH} tiles\n`;
            if (member.orientation) output += `  - Orientation: ${member.orientation}\n`;
            if (member.state || statePrefix) output += `  - State: ${member.state || statePrefix}\n`;
          } else if (member.type === 'group') {
            processMembers(member.members, member.state || statePrefix);
          }
        }
      };
      processMembers(data.members);
      
    } else {
      output += 'This is a **SINGLE ASSET**.\n\n';
      output += `- **ID:** \`${data.id}\`\n`;
      output += `  - Footprint: ${data.footprintW}x${data.footprintH} tiles\n`;
      if (data.canPlaceOnWalls) output += '  - **Placement:** Must be placed on WALLS.\n';
      if (data.canPlaceOnSurfaces) output += '  - **Placement:** Can be placed on SURFACES (e.g., desks).\n';
    }
    output += '\n';
  }
}

fs.writeFileSync('ASSET_DICTIONARY.md', output);
console.log('Done');
