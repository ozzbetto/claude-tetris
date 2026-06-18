# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

No build step required. Open directly or serve with any static file server:

```bash
open index.html                  # macOS — open directly
python3 -m http.server 8000      # then visit http://localhost:8000
```

## Architecture

Three files, no dependencies, no bundler:

- **`index.html`** — DOM structure: a `<canvas id="board">` (300×600 px) for the playfield and a `<canvas id="next-canvas">` (120×120 px) for the piece preview, plus a HUD panel and an overlay div reused for both Pause and Game Over states.
- **`style.css`** — dark/retro aesthetic; flexbox layout; `backdrop-filter` on overlays.
- **`game.js`** — all game logic (~300 lines, `'use strict'`, no modules).

### game.js internals

Key constants at the top of `game.js`: `COLS`, `ROWS`, `BLOCK` (px per cell), `COLORS` (indexed 1–7), `PIECES` (matrix definitions indexed 1–7), `LINE_SCORES`.

Global mutable state: `board` (ROWS×COLS 2D array, `0` = empty, `1–7` = piece color index), `current`/`next` piece objects (`{type, shape, x, y}`), plus `score`, `lines`, `level`, `paused`, `gameOver`, `dropAccum`, `dropInterval`, `animId`.

Core call chain:
```
init() → spawn() → requestAnimationFrame(loop)
loop(ts) → [gravity tick] → lockPiece() → merge() + clearLines() + spawn()
```

Rotation uses `rotateCW` (transpose + row-reverse). `tryRotate` applies wall kicks by trying column offsets `[0, -1, 1, -2, 2]` in order. Ghost piece (`ghostY`) projects the current piece straight down until `collide` returns true.

### Canvas sizing constraint

`canvas#board` width/height in `index.html` must equal `COLS × BLOCK` and `ROWS × BLOCK`. If you change any of those three constants, update the canvas attributes to match.
