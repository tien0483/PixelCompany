import type { ColorValue } from '../ui/types.js';

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h / 360 + 1 / 3);
    g = hue2rgb(p, q, h / 360);
    b = hue2rgb(p, q, h / 360 - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function lightnessFromB(b: number): number {
  return 0.5 + (b / 100) * 0.5;
}

export function colorValueToHex(color: ColorValue): string {
  const [r, g, b] = hslToRgb(color.h, color.s / 100, lightnessFromB(color.b));
  const toHex = (n: number) => {
    const hex = n.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToColorValue(hex: string): ColorValue {
  void hex;
  // Simple approximation or fallback for now.
  // Converting RGB back to ColorValue (which is an offset system or HSL) is complex.
  // Since we only need to pick colors, maybe we just store string everywhere?
  // Let's just return a generic color value for now, or assume the color picker handles it.
  return { h: 0, s: 0, b: 0, c: 0, colorize: true };
}
