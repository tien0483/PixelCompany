# Copyright (C) 2026 Akselos
"""Shared light/dark theme CSS + boot script for BIM capability HTML explainers."""

THEME_STORAGE_KEY = "bim-viz-theme"

# Applied in <head> before paint to avoid flash.
THEME_BOOT = f"""<script>
(function(){{
  try {{
    var t = localStorage.getItem('{THEME_STORAGE_KEY}');
    if (t !== 'light' && t !== 'dark') {{
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }}
    document.documentElement.classList.toggle('light', t === 'light');
    document.documentElement.classList.toggle('dark', t !== 'light');
  }} catch (e) {{}}
}})();
</script>"""

THEME_CSS = """
/* ---- Theme tokens ---- */
html { color-scheme: dark; }
html.light { color-scheme: light; }

html.light ::-webkit-scrollbar-track { background: #e2e8f0; }
html.light ::-webkit-scrollbar-thumb { background: #94a3b8; }
html.light ::-webkit-scrollbar-thumb:hover { background: #64748b; }

/* Page chrome — remap dark-first Tailwind utilities */
html.light,
html.light.bg-slate-950,
html.light body,
html.light .bg-slate-950 { background-color: #f8fafc !important; color: #0f172a !important; }

html.light .bg-slate-900,
html.light .bg-slate-900\\/90,
html.light .bg-slate-900\\/60 { background-color: #ffffff !important; }

html.light .bg-slate-800,
html.light .bg-slate-800\\/80,
html.light .bg-slate-800\\/60,
html.light .bg-slate-800\\/40 { background-color: #f1f5f9 !important; }

html.light .bg-slate-700,
html.light .bg-slate-700\\/60 { background-color: #e2e8f0 !important; }

html.light .bg-emerald-950\\/10 { background-color: #ecfdf5 !important; }

html.light .text-slate-100,
html.light .text-slate-200 { color: #0f172a !important; }
html.light .text-slate-300 { color: #334155 !important; }
html.light .text-slate-400 { color: #475569 !important; }
html.light .text-slate-500 { color: #64748b !important; }
html.light .text-slate-600 { color: #64748b !important; }

html.light .text-emerald-300,
html.light .text-emerald-400 { color: #047857 !important; }
html.light .text-amber-300,
html.light .text-amber-400 { color: #b45309 !important; }
html.light .text-red-300,
html.light .text-red-200,
html.light .text-red-400 { color: #b91c1c !important; }
html.light .text-blue-300,
html.light .text-blue-400 { color: #1d4ed8 !important; }
html.light .text-orange-200 { color: #c2410c !important; }

html.light .border-slate-800,
html.light .border-slate-700,
html.light .border-slate-700\\/60,
html.light .border-slate-700\\/50,
html.light .border-slate-600 { border-color: #cbd5e1 !important; }

html.light .border-emerald-500\\/20,
html.light .border-emerald-500\\/30,
html.light .border-emerald-500\\/40,
html.light .border-emerald-500\\/50 { border-color: #6ee7b7 !important; }

html.light .border-red-500\\/30,
html.light .border-red-500\\/40 { border-color: #fca5a5 !important; }

html.light .hover\\:bg-slate-700:hover,
html.light .hover\\:bg-slate-800\\/80:hover { background-color: #e2e8f0 !important; }

html.light .tab-active {
  border-bottom-color: #16a34a;
  color: #0f172a !important;
  background: #ecfdf5 !important;
}
html.light .stage-btn {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #0f172a;
}
html.light .stage-btn:hover { background: #f1f5f9; }
html.light .stage-btn.active { background: #16a34a; color: white; border-color: #16a34a; }

html.light .log-line.hot { background: rgba(239,68,68,0.12); }
html.light .log-line.ok { background: rgba(22,163,74,0.12); }
html.light .log-line.miss { background: rgba(245,158,11,0.14); }
html.light .log-line.redundant { background: rgba(245,158,11,0.14); }

html.light .bus-track { background: #e2e8f0; }
html.light .mem-box { border-color: rgba(100,116,139,0.45); background-color: #ffffff; }
html.light .lane-box { border-color: rgba(100,116,139,0.45); }

html.light code { color: #047857; }

/* Canvas / WebGL drawn for dark — soft invert in light mode */
html.light canvas:not(.no-theme-invert),
html.light #threejs-canvas-container canvas {
  filter: invert(1) hue-rotate(180deg);
}

/* The chart canvases draw on a transparent surface over a Tailwind `bg-slate-950` backdrop, and the
   invert above applies to the element *including* that backdrop. Without this the backdrop is first
   remapped to near-white by the rules further up, then inverted to near-black — light mode ended up
   with black chart panels on a white page. Keep the backdrop dark so the inversion lands light. */
html.light canvas:not(.no-theme-invert) {
  background-color: #0f172a !important;
  border-color: #1e293b !important;
}

/* Theme toggle button */
.theme-toggle {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.375rem 0.65rem; border-radius: 0.5rem;
  font-size: 0.75rem; font-weight: 500;
  border: 1px solid #334155; background: #1e293b; color: #e2e8f0;
  cursor: pointer;
}
html.light .theme-toggle {
  border-color: #cbd5e1; background: #ffffff; color: #0f172a;
}
.theme-toggle:hover { filter: brightness(1.08); }
"""

# Palette for the inline SVG diagrams (the two sequence charts, the ERD, the benchmark-knobs chart).
# They were authored light-first with hardcoded hex, which meant the only way to survive dark mode was
# a grey plate painted behind them. Driving them from variables lets both modes be first-class, and
# the fallbacks keep each SVG readable if it is ever opened on its own.
DIAGRAM_CSS = """
:root {
  --d-surface: #ffffff;   /* entity / box body            */
  --d-surface-2: #eef2f6; /* lane body — needs to read against a white page, so slightly darker
                             than the original #f4f6f8, which was near-invisible on white */
  --d-surface-3: #eaeef2;
  --d-line: #c9d1d9;      /* lifelines, light borders     */
  --d-edge: #24292f;      /* hard borders + arrow strokes */
  --d-fg: #24292f;
  --d-muted: #57606a;
  --d-accent: #0969da;
  --d-danger: #b42318;
  --d-danger-bg: #fdecea;
  --d-ok: #1a7f37;
  --d-ok-bg: #e6f4ea;
  --d-warn: #9a6700;
  --d-warn-bg: #fff8e1;
  --d-info-bg: #e7f0fd;
}
html.dark {
  --d-surface: #0f172a;
  --d-surface-2: #172033;
  --d-surface-3: #1e293b;
  --d-line: #334155;
  --d-edge: #94a3b8;
  --d-fg: #e2e8f0;
  --d-muted: #94a3b8;
  --d-accent: #60a5fa;
  --d-danger: #f87171;
  --d-danger-bg: #3f1a1a;
  --d-ok: #4ade80;
  --d-ok-bg: #14321f;
  --d-warn: #fbbf24;
  --d-warn-bg: #3a2f10;
  --d-info-bg: #16273f;
}
.diagram { width: 100%; height: auto; margin: 18px 0; }
"""

THEME_TOGGLE_BTN = """<button type="button" id="theme-toggle" class="theme-toggle" title="Toggle light / dark theme" aria-label="Toggle theme">
  <i data-lucide="sun" class="w-3.5 h-3.5 theme-icon-sun"></i>
  <i data-lucide="moon" class="w-3.5 h-3.5 theme-icon-moon hidden"></i>
  <span class="theme-toggle-label">Light</span>
</button>"""

THEME_INIT_JS = f"""
window.BimTheme = {{
  key: '{THEME_STORAGE_KEY}',
  isLight() {{ return document.documentElement.classList.contains('light'); }},
  apply(mode) {{
    const light = mode === 'light';
    document.documentElement.classList.toggle('light', light);
    document.documentElement.classList.toggle('dark', !light);
    try {{ localStorage.setItem(this.key, light ? 'light' : 'dark'); }} catch (e) {{}}
    this.syncToggle();
    window.dispatchEvent(new CustomEvent('bim-theme-change', {{ detail: {{ mode: light ? 'light' : 'dark' }} }}));
    if (window.app && typeof window.app.sync === 'function') window.app.sync();
  }},
  toggle() {{ this.apply(this.isLight() ? 'dark' : 'light'); }},
  syncToggle() {{
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const light = this.isLight();
    const sun = btn.querySelector('.theme-icon-sun');
    const moon = btn.querySelector('.theme-icon-moon');
    const label = btn.querySelector('.theme-toggle-label');
    if (sun) sun.classList.toggle('hidden', light);
    if (moon) moon.classList.toggle('hidden', !light);
    if (label) label.textContent = light ? 'Dark' : 'Light';
  }},
  init() {{
    this.syncToggle();
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  }}
}};
"""
