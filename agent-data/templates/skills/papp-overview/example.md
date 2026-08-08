# Coke Drum Overview — customer requirements

Site: Yasref refinery. Unit: DCU (delayed coker). Asset: Coke Drum `113-D-0006`.

We need a landing page an integrity engineer opens every morning and can read in ten
seconds: is this drum fine, and how long has it got.

## 1. Remaining-life banner

Split the top of the page into **Pressurized** and **Non-pressurized** parts, side by side.

Each side shows the governing remaining life, which component drives it, and the three
failure modes underneath.

| Group | Status | Governing life | Crack | Bulging | Fatigue |
|---|---|---|---|---|---|
| Pressurized | WARNING | 6.9 years (Cone) | 6.9 years (min) | 13.4 years | > 35 years |
| Non-pressurized | ATTENTION REQUIRED | 3.2 years (Skirt) | no data | no data | 3.2 years (min) |

Mark the governing mode so it is obvious which number the headline came from. Modes with no
data should say so rather than showing a zero.

## 2. Measurement cards

One row, left to right. Each card drills down to its own page.

| Card | Value | Limit / context | Sensor | Read at |
|---|---|---|---|---|
| Temperature | 43.72 °C | Inside DOW (limit 505 °C) | 113TI6164A.PV | 02/04/2026 18:30:00 |
| Pressure | -0.0062 Barg | Inside DOW (limit 11.73 Barg) | 113PI6160C.PV | 02/04/2026 18:30:00 |
| Utilized cycles | 37.2 % | 2,604 / 7,000 design cycles | — | — |
| Bulging | 84.755 % | max. plastic strain limit fraction, Cone | — | — |
| Crack | length 0.100 m / depth 0.001 m | Cone | — | — |
| Fatigue | 11.32 % / 90.40 % | Toriconical Head / Skirt | — | — |

Colour the card by severity: green healthy, amber warning, red attention required. The last
three are our worry, the first three are nominal.

## 3. Equipment data

A plain table of the asset's design data:

| Item | Value |
|---|---|
| Asset name | Coke Drum (113-D-0006) |
| Shell diameter | 9254 mm |
| Shell thickness | 52 mm |
| Skirt thickness | 30 mm |
| Design cycles | 7,000 |

## 4. Model

Show the analysis model next to the equipment data: the two drums in elevation with the
shell courses coloured by component, a legend naming them (head, shell C1…C10, skirt,
toriconical head, inlet nozzle, unheading system), a compass rose with the azimuth
convention (North 0°, East 90°) and the elevation scale down the left side.

## Header

Title `Yasref DCU D-0006 Dashboard`. Top right shows `Data Connectivity` and `Asset Status`
— both are currently disconnected/unknown because the live feed is not wired up yet, and
the page must not look broken when that is the case.
