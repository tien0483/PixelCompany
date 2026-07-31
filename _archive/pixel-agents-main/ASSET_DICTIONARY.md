# Pixel Office Furniture Asset Dictionary

Here is the complete dictionary of all available furniture assets, their exact IDs required for the layout generator, and their footprint sizes (Width × Height in tiles).

### Crucial Layout Engine Rules:
- **Asset ID vs Group ID:** For groups (like DESK, PC, SOFA), you MUST use the exact asset ID of the specific state/orientation you want (e.g., `DESK_FRONT`, `PC_FRONT_OFF`, `SOFA_FRONT`). Do not use the group name.
- **Grid Boundaries:** The layout is 40 columns by 26 rows. Coordinates `(0,0)` to `(39,25)`.
- **Overlaps:** Furniture cannot overlap unless `canPlaceOnSurfaces` is true (e.g., PC on DESK). Ensure footprints fit within room boundaries.

## Bin (BIN)

This is a **SINGLE ASSET**.

- **ID:** `BIN`
  - Footprint: 1x1 tiles

## Bookshelf (BOOKSHELF)

This is a **SINGLE ASSET**.

- **ID:** `BOOKSHELF`
  - Footprint: 2x1 tiles
  - **Placement:** Must be placed on WALLS.

## Cactus (CACTUS)

This is a **SINGLE ASSET**.

- **ID:** `CACTUS`
  - Footprint: 1x2 tiles

## Clock (CLOCK)

This is a **SINGLE ASSET**.

- **ID:** `CLOCK`
  - Footprint: 1x2 tiles
  - **Placement:** Must be placed on WALLS.

## Coffee (COFFEE)

This is a **SINGLE ASSET**.

- **ID:** `COFFEE`
  - Footprint: 1x1 tiles
  - **Placement:** Can be placed on SURFACES (e.g., desks).

## Coffee Table (COFFEE_TABLE)

This is a **SINGLE ASSET**.

- **ID:** `COFFEE_TABLE`
  - Footprint: 2x2 tiles

## Cushioned Bench (CUSHIONED_BENCH)

This is a **SINGLE ASSET**.

- **ID:** `CUSHIONED_BENCH`
  - Footprint: 1x1 tiles

## Cushioned Chair (CUSHIONED_CHAIR)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `CUSHIONED_CHAIR_FRONT`
  - Footprint: 1x1 tiles
  - Orientation: front
- **ID:** `CUSHIONED_CHAIR_BACK`
  - Footprint: 1x1 tiles
  - Orientation: back
- **ID:** `CUSHIONED_CHAIR_SIDE`
  - Footprint: 1x1 tiles
  - Orientation: side

## Desk (DESK)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `DESK_FRONT`
  - Footprint: 3x2 tiles
  - Orientation: front
- **ID:** `DESK_SIDE`
  - Footprint: 1x4 tiles
  - Orientation: side

## Double Bookshelf (DOUBLE_BOOKSHELF)

This is a **SINGLE ASSET**.

- **ID:** `DOUBLE_BOOKSHELF`
  - Footprint: 2x2 tiles
  - **Placement:** Must be placed on WALLS.

## Hanging Plant (HANGING_PLANT)

This is a **SINGLE ASSET**.

- **ID:** `HANGING_PLANT`
  - Footprint: 1x2 tiles
  - **Placement:** Must be placed on WALLS.
  - **Placement:** Can be placed on SURFACES (e.g., desks).

## Large Painting (LARGE_PAINTING)

This is a **SINGLE ASSET**.

- **ID:** `LARGE_PAINTING`
  - Footprint: 2x2 tiles
  - **Placement:** Must be placed on WALLS.

## Large Plant (LARGE_PLANT)

This is a **SINGLE ASSET**.

- **ID:** `LARGE_PLANT`
  - Footprint: 2x3 tiles

## PC (PC)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `PC_FRONT_ON_1`
  - Footprint: 1x2 tiles
  - State: on
- **ID:** `PC_FRONT_ON_2`
  - Footprint: 1x2 tiles
  - State: on
- **ID:** `PC_FRONT_ON_3`
  - Footprint: 1x2 tiles
  - State: on
- **ID:** `PC_FRONT_OFF`
  - Footprint: 1x2 tiles
  - State: off
- **ID:** `PC_BACK`
  - Footprint: 1x2 tiles
  - Orientation: back
- **ID:** `PC_SIDE`
  - Footprint: 1x2 tiles
  - Orientation: side

## Plant (PLANT)

This is a **SINGLE ASSET**.

- **ID:** `PLANT`
  - Footprint: 1x2 tiles

## Plant (PLANT_2)

This is a **SINGLE ASSET**.

- **ID:** `PLANT_2`
  - Footprint: 1x2 tiles

## Pot (POT)

This is a **SINGLE ASSET**.

- **ID:** `POT`
  - Footprint: 1x1 tiles

## Small Painting (SMALL_PAINTING)

This is a **SINGLE ASSET**.

- **ID:** `SMALL_PAINTING`
  - Footprint: 1x2 tiles
  - **Placement:** Must be placed on WALLS.

## Small Painting (SMALL_PAINTING_2)

This is a **SINGLE ASSET**.

- **ID:** `SMALL_PAINTING_2`
  - Footprint: 1x2 tiles
  - **Placement:** Must be placed on WALLS.

## Small Table (SMALL_TABLE)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `SMALL_TABLE_FRONT`
  - Footprint: 2x2 tiles
  - Orientation: front
- **ID:** `SMALL_TABLE_SIDE`
  - Footprint: 1x3 tiles
  - Orientation: side

## Sofa (SOFA)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `SOFA_FRONT`
  - Footprint: 2x1 tiles
  - Orientation: front
- **ID:** `SOFA_BACK`
  - Footprint: 2x1 tiles
  - Orientation: back
- **ID:** `SOFA_SIDE`
  - Footprint: 1x2 tiles
  - Orientation: side

## Table (TABLE_FRONT)

This is a **SINGLE ASSET**.

- **ID:** `TABLE_FRONT`
  - Footprint: 3x4 tiles

## Whiteboard (WHITEBOARD)

This is a **SINGLE ASSET**.

- **ID:** `WHITEBOARD`
  - Footprint: 2x2 tiles
  - **Placement:** Must be placed on WALLS.

## Wooden Bench (WOODEN_BENCH)

This is a **SINGLE ASSET**.

- **ID:** `WOODEN_BENCH`
  - Footprint: 1x1 tiles

## Wooden Chair (WOODEN_CHAIR)

This is a **GROUP**. You must use one of the following specific Asset IDs to place it:

- **ID:** `WOODEN_CHAIR_FRONT`
  - Footprint: 1x2 tiles
  - Orientation: front
- **ID:** `WOODEN_CHAIR_BACK`
  - Footprint: 1x2 tiles
  - Orientation: back
- **ID:** `WOODEN_CHAIR_SIDE`
  - Footprint: 1x2 tiles
  - Orientation: side

