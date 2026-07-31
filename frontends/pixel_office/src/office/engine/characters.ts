import {
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the active HookProvider via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  isReplayMode = false,
): void {
  ch.frameTimer += dt;
  // -- NPC Script Scheduler --
  if (ch.isNpc && ch.actionQueue && ch.actionQueue.length > 0) {
    if (ch.scriptIndex === undefined) ch.scriptIndex = 0;
    let startNextAction = false;
    const currentAction = ch.actionQueue[ch.scriptIndex];

    if (!ch.actionStarted) {
      startNextAction = true;
    } else if (currentAction) {
      // Check if current action finished
      if (currentAction.kind === 'walkTo') {
        if (ch.state !== CharacterState.WALK && ch.path.length === 0) {
          startNextAction = true;
        }
      } else if (currentAction.kind === 'typeAtSeat' || currentAction.kind === 'wander') {
        ch.seatTimer -= dt;
        if (ch.seatTimer <= 0) {
          startNextAction = true;
        }
      } else if (currentAction.kind === 'patrol') {
        if (ch.state !== CharacterState.WALK && ch.path.length === 0) {
          ch.wanderCount = (ch.wanderCount + 1) % currentAction.waypoints.length;
          const wp = currentAction.waypoints[ch.wanderCount];
          const path = wp
            ? findPath(ch.tileCol, ch.tileRow, wp.col, wp.row, tileMap, blockedTiles)
            : [];
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
          } else {
            ch.state = CharacterState.IDLE;
            ch.wanderTimer = 999999;
          }
        }
      }
    }

    if (startNextAction) {
      if (ch.actionStarted) {
        ch.scriptIndex = (ch.scriptIndex + 1) % ch.actionQueue.length;
      }
      ch.actionStarted = true;
      const nextAction = ch.actionQueue[ch.scriptIndex];

      if (!nextAction) {
        // Empty slot (queue mutated mid-frame) — resume on the next tick.
      } else if (nextAction.kind === 'walkTo') {
        const path = findPath(
          ch.tileCol,
          ch.tileRow,
          nextAction.col,
          nextAction.row,
          tileMap,
          blockedTiles,
        );
        if (path.length > 0) {
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
        } else {
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = 999999;
        }
      } else if (nextAction.kind === 'typeAtSeat') {
        ch.state = CharacterState.TYPE;
        ch.seatTimer = nextAction.seconds;
        if (ch.seatId) {
          const seat = seats.get(ch.seatId);
          if (seat) ch.dir = seat.facingDir;
        }
      } else if (nextAction.kind === 'wander') {
        ch.state = CharacterState.IDLE;
        ch.seatTimer = nextAction.seconds;
        ch.wanderTimer = 0; // immediate step
      } else if (nextAction.kind === 'patrol') {
        ch.wanderCount = 0;
        const wp = nextAction.waypoints[0];
        if (wp) {
          const path = findPath(ch.tileCol, ch.tileRow, wp.col, wp.row, tileMap, blockedTiles);
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
          } else {
            ch.state = CharacterState.IDLE;
            ch.wanderTimer = 999999;
          }
        }
      }
    }

    // Prevent wandering during IDLE if action is not 'wander'
    if (ch.state === CharacterState.IDLE && ch.actionQueue[ch.scriptIndex]?.kind !== 'wander') {
      ch.wanderTimer = 999999;
    }
  }

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isNpc && !ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, pathfind to seat
      if (!ch.isNpc && ch.isActive) {
        if (!ch.seatId || ch.pinnedTile) {
          // No seat assigned or pinned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          ch.dir = Direction.DOWN;
          break;
        }
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            // Already at seat or no path — sit down
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }
      // Countdown wander timer
      if (!ch.pinnedTile) {
        ch.wanderTimer -= dt;
      }
      // Recorded agents never wander autonomously during replay, but authored
      // NPCs (roleplay scripts / layout NPCs) still may when their timer fires.
      if (ch.wanderTimer <= 0 && !ch.pinnedTile && (!isReplayMode || ch.isNpc)) {
        // Check if we've wandered enough — return to seat for a rest
        if (ch.wanderCount >= ch.wanderLimit && ch.seatId && !ch.pinnedTile) {
          const seat = seats.get(ch.seatId);
          if (seat) {
            const path = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
        }
        const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
        if (target) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (!ch.isNpc) {
          if (ch.isActive) {
            if (!ch.seatId) {
              // No seat — type in place
              ch.state = CharacterState.TYPE;
            } else {
              const seat = seats.get(ch.seatId);
              if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
                ch.state = CharacterState.TYPE;
                ch.dir = seat.facingDir;
              } else {
                ch.state = CharacterState.IDLE;
              }
            }
          } else {
            // Check if arrived at assigned seat — sit down for a rest before wandering again
            if (ch.seatId) {
              const seat = seats.get(ch.seatId);
              if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
                ch.state = CharacterState.TYPE;
                ch.dir = seat.facingDir;
                // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
                // "turn just ended" — skip the long rest so idle transition is immediate
                if (ch.seatTimer < 0) {
                  ch.seatTimer = 0;
                } else {
                  ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
                }
                ch.wanderCount = 0;
                ch.wanderLimit = randomInt(
                  WANDER_MOVES_BEFORE_REST_MIN,
                  WANDER_MOVES_BEFORE_REST_MAX,
                );
                ch.frame = 0;
                ch.frameTimer = 0;
                break;
              }
            }
            ch.state = CharacterState.IDLE;
            ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
          }
        } else {
          // NPC arrived. Let it idle until the scheduler advances it next tick.
          ch.state = CharacterState.IDLE;
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      if (!nextTile) break;
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering, repath to seat
      if (!ch.isNpc && ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  // The modulo provably lands inside each tuple, but a computed index widens to
  // `number` under noUncheckedIndexedAccess — narrow it back to the tuple's arity.
  const frame2 = (ch.frame % 2) as 0 | 1;
  const frame4 = (ch.frame % 4) as 0 | 1 | 2 | 3;
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][frame2];
      }
      return sprites.typing[ch.dir][frame2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][frame4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
