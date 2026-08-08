# Process Monitoring page — customer requirements

Site: Yasref refinery. Unit: DCU. Asset: Coke Drum `113-D-0006`.

This page answers "what have the sensors been doing, and did anything leave its design
window". Engineers open it after a cycle and scrub back through the last week.

## 1. Headline limit cards

One row of three. Each shows the worst value in the selected window, whether it stayed
inside the design operating window (DOW), the sensor it came from, and how many times it
went outside in the last 30 and 90 days.

| Card | Value | DOW | Sensor | 30d exc | 90d exc |
|---|---|---|---|---|---|
| Max. temperature | 44.15 °C | inside (limit 505 °C) | 113TI6164A.PV | 0 | 0 |
| Max. pressure | -0.00 Barg | inside (limit 11.73 Barg) | 113PI6160C.PV | 0 | 0 |
| Max. coke level | 27.43 % | — | 113LI6101.PV | — | — |

## 2. Time-series charts

Three charts, each in its own card with a download button and a toggle to see the numbers
as a table:

- **Thermocouples** — temperature [DegC], y range 0…500, dashed line at `Max Design: 505`.
- **Coke level** — coke level [%], noisy signal, y range -20…30.
- **Pressure sensor** — pressure [Barg], y range -2…12, dashed line at `Max Design: 11.73`.

All three share the x axis (`Date`, `DD/MM/YYYY`) and need a zoom slider — a week of data at
full resolution is unreadable otherwise.

## 3. Time controls

A panel with `Duration: Last 7 days`, `From date: 26/03/2026`, `To date: 02/04/2026`, a
range slider under the two dates, and `Latest Update: 02/04/2026` shown at the top right.

## 4. Sensor locations

A drawing of the drum with the temperature sensors pinned where they physically sit, each
labelled with its tag (`113TI6164A.PV`, `113TI6164B.PV`, `113TI6164C.PV`, `113TI6164D.PV`).
Include a fullscreen control, a reset-view control and the North/West/Vertical-Up axes.

## 5. DOW exceedance log

Below the coke-level chart. It shows the parameter, its DOW limit and the window, with a
`Temperature` / `Pressure` toggle. Right now there is nothing to show — it must say
"No exceedance data in the last 90 days" rather than render an empty table.

## Header

Title `Yasref DCU D-0006 Dashboard`, the `Data Connectivity` / `Asset Status` pair, and an
`Inspect Last Cycle` button at the far right that jumps to cycle inspection.
