export async function imageToGrid(file: File, targetWidth: number, targetHeight: number): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Canvas 2D context not available'));
      }
      
      // Force nearest-neighbor scaling for pixel art look
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;
      
      const grid: string[][] = [];
      for (let y = 0; y < targetHeight; y++) {
        const row: string[] = [];
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          
          if (a === 0) {
            row.push('');
          } else {
            const hexR = r.toString(16).padStart(2, '0');
            const hexG = g.toString(16).padStart(2, '0');
            const hexB = b.toString(16).padStart(2, '0');
            if (a === 255) {
              row.push(`#${hexR}${hexG}${hexB}`);
            } else {
              const hexA = a.toString(16).padStart(2, '0');
              row.push(`#${hexR}${hexG}${hexB}${hexA}`);
            }
          }
        }
        grid.push(row);
      }
      resolve(grid);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}
