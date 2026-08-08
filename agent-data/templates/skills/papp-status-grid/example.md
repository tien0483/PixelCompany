# Waste Gas HEX Dashboard — requested changes

*(In a real plan this paragraph is followed by a pasted screenshot of the current page with
red annotation boxes — `![spec](my-plan.assets/waste-gas-hex-spec.png)`. The template reads
that image; the numbered boxes on it match the numbered instructions below.)*

1. **Simplify interface:** Tracking one representative HEX per ASU, as all A/B/C/D share the
   same sensor.
2. **Status indicators:** Use simple green and grey boxes to indicate the operating status
   of each HEX (operational and non-operational, respectively).
3. **Remove charts:** Remove the stress & fatigue bar charts and the donut chart.
4. **Add pop-ups:** Add interactive pop-ups displaying time-evolution of cumulative damage
   directly adjacent to each HEX box.
5. **Consolidate view:** Include both Train 1 and Train 2 on a single page.

## Current data

Four ASUs per train, four heat exchangers each (A/B/C/D). Each exchanger reports Von-Mises
stress in MPa and accumulated fatigue damage in %.

| ASU | A stress / damage | B stress / damage | C stress / damage | D stress / damage |
|---|---|---|---|---|
| 2E-2146 | 145.98 / 60.00 | 135.25 / 35.80 | 112.52 / 35.60 | 127.57 / 36.80 |
| 2E-2246 | 138.99 / 43.20 | 157.06 / 47.80 | 145.55 / 44.60 | 146.98 / 42.30 |
| 2E-2346 | 136.25 / 25.20 | 113.52 / 23.60 | 128.57 / 21.30 | 139.99 / 22.70 |
| 2E-2446 | 158.06 / 39.20 | 146.55 / 38.80 | 147.98 / 38.60 | 137.25 / 39.80 |

Tile colour follows fatigue damage: below 25 % green, 25–35 % yellow, 35–45 % amber,
45–55 % orange, above 55 % red.

32 exchangers exist in total; 21 are in service and 11 are out of service. Keep a
`Go To Monitor` button and the `Version 3.0` line at the bottom of the sidebar.
