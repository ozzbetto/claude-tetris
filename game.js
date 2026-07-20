'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // 1: I - cian
  '#ffd54f', // 2: O - amarillo
  '#ba68c8', // 3: T - púrpura
  '#81c784', // 4: S - verde
  '#e57373', // 5: Z - rojo
  '#5b9bd5', // 6: J - azul pálido
  '#ffb74d', // 7: L - naranja
  // --- Piezas especiales ---
  '#26c6da', //  8: + (cruz)      — cian intenso
  '#9575cd', //  9: U             — violeta
  '#66bb6a', // 10: Y (pentominó) — verde claro
  '#fff176', // 11: 1×1 (recomp.) — amarillo brillante
  '#ef5350', // 12: 3×3 hueca     — rojo (reto)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // 1: I
  [[2,2],[2,2]],                               // 2: O
  [[0,3,0],[3,3,3],[0,0,0]],                  // 3: T
  [[0,4,4],[4,4,0],[0,0,0]],                  // 4: S
  [[5,5,0],[0,5,5],[0,0,0]],                  // 5: Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // 6: J
  [[0,0,7],[7,7,7],[0,0,0]],                  // 7: L
  // --- Piezas especiales (índices 8–12) ---
  // 8: + (cruz 3×3) — rotativamente simétrica, eje en celda central
  [[0,8,0],
   [8,8,8],
   [0,8,0]],
  // 9: U (3×3) — apertura hacia arriba; 5 celdas llenas
  [[9,0,9],
   [9,9,9],
   [0,0,0]],
  // 10: Y (pentominó 5×5) — línea de 4 + bulto lateral; eje centrado en (2,2)
  [[0, 0, 0, 0,0],
   [0, 0,10, 0,0],
   [0,10,10, 0,0],
   [0, 0,10, 0,0],
   [0, 0,10, 0,0]],
  // 11: 1×1 (single) — SOLO por recompensa tras Tetris, nunca en pool aleatorio
  [[11]],
  // 12: 3×3 hueca (anillo de 8 bloques, centro (1,1) = 0 → no colisiona ni hace merge)
  [[12,12,12],
   [12, 0,12],
   [12,12,12]],
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// --- Skins visuales del tablero (ortogonal al tema claro/oscuro de la página) ---
// Cada skin define su propia paleta de colores (o reutiliza COLORS) y se pinta
// mediante una función dedicada en SKIN_PAINTERS, seleccionada según `currentSkin`.
const PASTEL_COLORS = [
  null,
  '#a8dadc', //  1: I
  '#ffe8a3', //  2: O
  '#d8bbf0', //  3: T
  '#b8e6b0', //  4: S
  '#f4b6b6', //  5: Z
  '#a9c9e8', //  6: J
  '#f9cf9a', //  7: L
  '#a3e0e6', //  8: + (cruz)
  '#c9b3e8', //  9: U
  '#b0e0b6', // 10: Y (pentominó)
  '#fff2b0', // 11: 1×1 (recompensa)
  '#f0a8a8', // 12: 3×3 hueca (reto)
];

const SKINS = {
  retro:  { label: 'Retro',     colors: COLORS },
  neon:   { label: 'Neon',      colors: COLORS },
  pastel: { label: 'Pastel',    colors: PASTEL_COLORS },
  pixel:  { label: 'Pixel art', colors: COLORS },
};

let currentSkin = 'retro';

// --- Configuración de piezas especiales ---
// Probabilidad de que aparezca una pieza de reto en lugar de una estándar (0–1).
const CHALLENGE_RATE  = 0.05;
// Tipos que entran al pool de reto; la 1×1 (tipo 11) queda excluida del azar.
const CHALLENGE_TYPES = [8, 9, 10, 12];
// Tipo reservado para la recompensa por Tetris.
const SINGLE_TYPE     = 11;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
// Flag: si es true, el próximo spawn entrega la pieza 1×1 de recompensa (tras Tetris).
let pendingReward;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Construye un objeto pieza centrado horizontalmente en la fila 0.
// Funciona para cualquier tamaño de matriz (1×1, 3×3, 5×5…).
function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return {
    type,
    shape,
    x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
    y: 0,
  };
}

// Devuelve una pieza aleatoria:
//   · ~95% → una de las 7 piezas estándar (tipos 1–7).
//   · ~5%  → una pieza del set de reto (CHALLENGE_TYPES).
// La 1×1 NUNCA entra en esta función; solo se entrega por recompensa.
function randomPiece() {
  const type = Math.random() < CHALLENGE_RATE
    ? CHALLENGE_TYPES[Math.floor(Math.random() * CHALLENGE_TYPES.length)]
    : Math.floor(Math.random() * 7) + 1;
  return makePiece(type);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    // Tetris (4 líneas simultáneas) → recompensa: la próxima pieza es la 1×1.
    if (cleared === 4) pendingReward = true;
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  if (pendingReward) {
    // Recompensa por Tetris: la 1×1 cae de inmediato.
    // La pieza que estaba en el preview (next) NO se descarta; caerá en el siguiente turno.
    current = makePiece(SINGLE_TYPE);
    pendingReward = false;
  } else {
    current = next;
    next = randomPiece();
  }
  if (collide(current.shape, current.x, current.y)) endGame();
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// --- Pintores por skin ---
// Cada función recibe (context, x, y, color, size) en coordenadas de celda
// y pinta un único bloque; drawBlock() elige cuál usar según currentSkin.

function paintRetroBlock(context, x, y, color, size) {
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
}

function paintNeonBlock(context, x, y, color, size) {
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  // fondo oscuro de la celda para que el glow resalte
  context.fillStyle = '#0a0a12';
  context.fillRect(px, py, s, s);
  context.shadowBlur = size * 0.6;
  context.shadowColor = color;
  context.fillStyle = color;
  context.fillRect(px + 2, py + 2, s - 4, s - 4);
  context.shadowBlur = 0;
  // brillo interior
  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.fillRect(px + 2, py + 2, s - 4, 3);
}

function paintPastelBlock(context, x, y, color, size) {
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  const radius = Math.min(6, s / 4);

  const roundedPath = (rx, ry, rw, rh, rr) => {
    context.beginPath();
    if (context.roundRect) {
      context.roundRect(rx, ry, rw, rh, rr);
    } else {
      // esquinas redondeadas dibujadas manualmente (navegadores sin roundRect)
      context.moveTo(rx + rr, ry);
      context.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
      context.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
      context.arcTo(rx, ry + rh, rx, ry, rr);
      context.arcTo(rx, ry, rx + rw, ry, rr);
      context.closePath();
    }
  };

  context.fillStyle = color;
  roundedPath(px, py, s, s, radius);
  context.fill();

  // brillo suave superior
  context.fillStyle = 'rgba(255,255,255,0.35)';
  roundedPath(px + 2, py + 2, s - 4, Math.max(1, s * 0.35), radius / 2);
  context.fill();
}

function paintPixelBlock(context, x, y, color, size) {
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  const half = s / 2;

  context.fillStyle = color;
  context.fillRect(px, py, s, s);

  // textura tipo pixel-art: cuadrícula interior 2×2 con sombreado alterno
  context.fillStyle = 'rgba(0,0,0,0.15)';
  context.fillRect(px, py, half, half);
  context.fillRect(px + half, py + half, s - half, s - half);
  context.fillStyle = 'rgba(255,255,255,0.18)';
  context.fillRect(px + half, py, s - half, half);
  context.fillRect(px, py + half, half, s - half);

  // borde grueso oscuro para reforzar el look pixelado
  context.strokeStyle = 'rgba(0,0,0,0.35)';
  context.lineWidth = 2;
  context.strokeRect(px + 1, py + 1, s - 2, s - 2);
}

const SKIN_PAINTERS = {
  retro: paintRetroBlock,
  neon: paintNeonBlock,
  pastel: paintPastelBlock,
  pixel: paintPixelBlock,
};

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[currentSkin] ? currentSkin : 'retro';
  const color = SKINS[skin].colors[colorIndex];
  const paint = SKIN_PAINTERS[skin] || paintRetroBlock;
  context.save();
  context.globalAlpha = alpha ?? 1;
  paint(context, x, y, color, size);
  context.restore();
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (currentSkin === 'neon') {
    // fondo oscuro fijo para el tablero, independiente del tema de la página
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (currentSkin === 'neon') {
    nextCtx.fillStyle = '#05050a';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
  const shape = next.shape;
  // Rejilla dinámica: mínimo 4 celdas (piezas estándar), 5 para pentominós.
  // NB se ajusta para que la pieza más grande quepa siempre en el canvas.
  const cells = Math.max(4, shape.length, shape[0].length);
  const NB = nextCanvas.width / cells;
  const offX = Math.floor((cells - shape[0].length) / 2);
  const offY = Math.floor((cells - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver || paused) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  pendingReward = false; // reinicia la recompensa de Tetris al comenzar o reiniciar
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light');
    themeBtn.textContent = '☾ DARK';
  } else {
    document.body.classList.remove('light');
    themeBtn.textContent = '☀ LIGHT';
  }
  localStorage.setItem('theme', theme);
}

// Cambia la skin visual del tablero (canvas), sin afectar el tema de la página.
// Persiste la elección y repinta de inmediato el tablero, la pieza fantasma y el preview.
function applySkin(skin) {
  currentSkin = SKINS[skin] ? skin : 'retro';
  if (skinSelect) skinSelect.value = currentSkin;
  localStorage.setItem('tetris.skin', currentSkin);
  draw();
  drawNext();
}

restartBtn.addEventListener('click', init);

themeBtn.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
});

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
});

applyTheme(localStorage.getItem('theme') || 'dark');

init();

applySkin(localStorage.getItem('tetris.skin') || 'retro');
