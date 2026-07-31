/**
 * jacked — provider visual identity (Claude / Codex / Cursor / Antigravity).
 *
 * Single source of truth for the per-account provider mark so the dashboard
 * cards, the menu-bar panel rows, and any future surface render the same
 * colored logo + label and can never disagree (same pattern as the shared
 * renderUsageBar). Unknown/missing provider falls back to Claude.
 */

function providerMeta(provider) {
    const p = String(provider || 'claude').toLowerCase();
    if (p === 'codex') {
        return {
            key: 'codex',
            label: 'Codex',
            color: '#60a5fa',
            labelColor: '#93c5fd',
            svg:
                '<svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" ' +
                'stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">' +
                '<polygon points="8,1.6 13.5,4.8 13.5,11.2 8,14.4 2.5,11.2 2.5,4.8"/>' +
                '<circle cx="8" cy="8" r="1.9"/>' +
                '</svg>',
        };
    }
    if (p === 'cursor') {
        return {
            key: 'cursor',
            label: 'Cursor',
            color: '#94a3b8',
            labelColor: '#cbd5e1',
            // Cursor-mark: angled chevron (distinct from Claude spokes / Codex hex).
            svg:
                '<svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 3.5 L12 8 L4 12.5 Z"/>' +
                '</svg>',
        };
    }
    if (p === 'antigravity') {
        return {
            key: 'antigravity',
            label: 'Antigravity',
            color: '#2dd4bf',
            labelColor: '#5eead4',
            // Orbit ring — distinct closed curve vs Codex hex.
            svg:
                '<svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" ' +
                'stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
                '<ellipse cx="8" cy="8" rx="5.5" ry="3.2" transform="rotate(-28 8 8)"/>' +
                '<circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>' +
                '</svg>',
        };
    }
    return {
        key: 'claude',
        label: 'Claude',
        color: '#a78bfa',
        labelColor: '#c4b5fd',
        svg:
            '<svg viewBox="0 0 16 16" width="100%" height="100%" stroke="currentColor" ' +
            'stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
            [0, 45, 90, 135]
                .map((a) => `<line x1="8" y1="2.4" x2="8" y2="13.6" transform="rotate(${a} 8 8)"/>`)
                .join('') +
            '</svg>',
    };
}

/** Compact glyph (logo only, brand-colored) — for tight surfaces (the panel). */
function providerGlyph(provider) {
    const m = providerMeta(provider);
    return (
        `<span class="provider-glyph provider-${m.key}" title="${m.label} account" ` +
        `aria-label="${m.label} account" style="color:${m.color}">${m.svg}</span>`
    );
}

/** Full badge (logo + label chip) — for the roomier dashboard cards. */
function providerBadge(provider) {
    const m = providerMeta(provider);
    return (
        `<span class="provider-badge provider-${m.key}" title="${m.label} account" ` +
        `style="--provider-color:${m.color}">` +
        `<span class="provider-glyph" style="color:${m.color}">${m.svg}</span>` +
        `<span class="provider-label" style="color:${m.labelColor}">${m.label}</span></span>`
    );
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { providerMeta, providerGlyph, providerBadge };
}
