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
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const controlsToggleBtn = document.getElementById('controls-toggle-btn');
const pauseControlsList = document.getElementById('pause-controls-list');
const startLevelSelect = document.getElementById('start-level-select');

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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
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
  pauseMenu.classList.add('hidden'); // el menú de pausa no aplica en game over
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    pauseMenu.classList.add('hidden');
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    pauseMenu.classList.remove('hidden');
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

// Lee el nivel inicial guardado en localStorage (clave 'tetris.startLevel').
// Devuelve un entero entre 1 y 10; si no hay valor válido guardado, devuelve 1.
function getStartLevel() {
  const stored = parseInt(localStorage.getItem('tetris.startLevel'), 10);
  return (stored >= 1 && stored <= 10) ? stored : 1;
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = getStartLevel();
  paused = false;
  gameOver = false;
  pendingReward = false; // reinicia la recompensa de Tetris al comenzar o reiniciar
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  pauseControlsList.classList.add('hidden');
  controlsToggleBtn.textContent = 'Ver controles';
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
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

restartBtn.addEventListener('click', init);

themeBtn.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
});

resumeBtn.addEventListener('click', () => {
  if (paused) togglePause();
});

controlsToggleBtn.addEventListener('click', () => {
  const nowHidden = pauseControlsList.classList.toggle('hidden');
  controlsToggleBtn.textContent = nowHidden ? 'Ver controles' : 'Ocultar controles';
});

startLevelSelect.addEventListener('change', () => {
  localStorage.setItem('tetris.startLevel', startLevelSelect.value);
});

applyTheme(localStorage.getItem('theme') || 'dark');
startLevelSelect.value = String(getStartLevel());

init();
