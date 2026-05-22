// ─────────────────────────────────────────────────────────────────────────────
//  Mood Board Maker
//  Add images → drag & resize them freely → auto-saved → export as PNG.
// ─────────────────────────────────────────────────────────────────────────────


// ─── STATE ────────────────────────────────────────────────────────────────────
// `tiles` is our single source of truth — an array of objects, one per image.
// Each tile: { id, src, x, y, width, height, z }

let tiles    = [];
let zCounter = 10; // Each tile brought to front gets the next z-index number

// These track whatever is currently being dragged or resized
let dragging     = null; // { tile, el }
let dragOffsetX  = 0;    // Where inside the tile the mouse clicked (X)
let dragOffsetY  = 0;    // Where inside the tile the mouse clicked (Y)

let resizing     = null; // { tile, el }
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;


// ─── DOM REFERENCES ───────────────────────────────────────────────────────────

const board     = document.getElementById('board');
const fileInput = document.getElementById('fileInput');
const hint      = document.getElementById('hint');


// ─── STARTUP ──────────────────────────────────────────────────────────────────
// Restore whatever was saved last time the page was open.

loadFromStorage();


// ─── TOOLBAR BUTTONS ──────────────────────────────────────────────────────────

document.getElementById('addBtn').addEventListener('click', () => fileInput.click());

document.getElementById('clearBtn').addEventListener('click', () => {
  if (tiles.length === 0) return;
  if (!confirm('Clear the entire board?')) return;
  tiles = [];
  board.innerHTML = '';
  board.appendChild(hint); // Put the hint text back
  hint.style.display = 'block';
  localStorage.removeItem('moodboard');
});

document.getElementById('exportBtn').addEventListener('click', exportBoard);


// ─── FILE INPUT ───────────────────────────────────────────────────────────────
// Fires when the user picks files through the system dialog.

fileInput.addEventListener('change', e => {
  for (const file of e.target.files) {
    if (file.type.startsWith('image/')) addImageFromFile(file);
  }
  fileInput.value = ''; // Reset so the same file can be selected again
});


// ─── DROP FILES ONTO THE BOARD ────────────────────────────────────────────────
// You can also drag image files directly from Finder onto the board.

board.addEventListener('dragover', e => e.preventDefault());

board.addEventListener('drop', e => {
  e.preventDefault();
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) addImageFromFile(file);
  }
});


// ─── ADD IMAGE FROM FILE ──────────────────────────────────────────────────────
// We resize the image before storing it — base64 strings are large,
// and localStorage has a ~5 MB limit across all keys on a domain.

function addImageFromFile(file) {
  const reader = new FileReader();

  reader.onload = e => {
    const img = new Image();

    img.onload = () => {
      // Shrink to max 1000px on the longest side, save as JPEG at 80% quality.
      // This keeps localStorage usage manageable without visible quality loss.
      const MAX = 1000;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const src = canvas.toDataURL('image/jpeg', 0.8);

      // Starting size on the board: max 280px wide, height proportional
      const tileW = Math.min(280, w);
      const tileH = Math.round(h * tileW / w);

      // Small random offset so multiple uploads don't all stack on the same spot
      const x = 40 + Math.random() * 80;
      const y = 40 + Math.random() * 80;

      createTile({ src, x, y, width: tileW, height: tileH });
    };

    img.src = e.target.result;
  };

  reader.readAsDataURL(file);
}


// ─── CREATE TILE ──────────────────────────────────────────────────────────────
// Adds a tile to the state array and puts it on the board.

function createTile(data) {
  const tile = {
    id:     Date.now() + Math.random(), // Simple unique ID
    src:    data.src,
    x:      data.x,
    y:      data.y,
    width:  data.width,
    height: data.height,
    z:      zCounter++,
  };

  tiles.push(tile);
  board.appendChild(renderTile(tile));
  hint.style.display = 'none'; // Hide the empty-state hint
  saveToStorage();
}


// ─── RENDER TILE ──────────────────────────────────────────────────────────────
// Builds the DOM element for a tile and wires up its events.

function renderTile(tile) {
  const el = document.createElement('div');
  el.className  = 'tile';
  el.id         = `tile-${tile.id}`;
  el.style.left   = tile.x + 'px';
  el.style.top    = tile.y + 'px';
  el.style.width  = tile.width  + 'px';
  el.style.height = tile.height + 'px';
  el.style.zIndex = tile.z;

  const img = document.createElement('img');
  img.src       = tile.src;
  img.draggable = false; // Disable the browser's built-in image drag behaviour
  el.appendChild(img);

  const deleteBtn = document.createElement('button');
  deleteBtn.className   = 'tile__delete';
  deleteBtn.textContent = '×';
  deleteBtn.title       = 'Remove';
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation(); // Prevent the click from starting a drag
    deleteTile(tile.id);
  });
  el.appendChild(deleteBtn);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'tile__resize';
  resizeHandle.addEventListener('mousedown', e => {
    e.stopPropagation();
    startResize(e, tile, el);
  });
  el.appendChild(resizeHandle);

  // Dragging starts on mousedown anywhere on the tile
  // (except the delete button and resize handle, which stopPropagation above)
  el.addEventListener('mousedown', e => {
    startDrag(e, tile, el);
  });

  return el;
}


// ─── DRAG ─────────────────────────────────────────────────────────────────────

function startDrag(e, tile, el) {
  e.preventDefault(); // Stops text selection and native browser drag

  dragging = { tile, el };
  bringToFront(tile, el);

  // Calculate where inside the tile the user clicked.
  // Without this, the tile would jump so its top-left corner is under the cursor.
  const rect  = el.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
}


// ─── RESIZE ───────────────────────────────────────────────────────────────────

function startResize(e, tile, el) {
  e.preventDefault();

  resizing     = { tile, el };
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  resizeStartW = tile.width;
  resizeStartH = tile.height;

  bringToFront(tile, el);
}


// ─── MOUSE MOVE ───────────────────────────────────────────────────────────────
// Listening on `document` — NOT on the tile.
// If you listen on the tile, moving the mouse faster than the element updates
// causes the cursor to leave the tile and the drag stops. Global = no escape.

document.addEventListener('mousemove', e => {
  if (dragging) {
    const boardRect    = board.getBoundingClientRect();
    dragging.tile.x    = e.clientX - boardRect.left - dragOffsetX;
    dragging.tile.y    = e.clientY - boardRect.top  - dragOffsetY;
    dragging.el.style.left = dragging.tile.x + 'px';
    dragging.el.style.top  = dragging.tile.y + 'px';
  }

  if (resizing) {
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    resizing.tile.width  = Math.max(80, resizeStartW + dx);
    resizing.tile.height = Math.max(60, resizeStartH + dy);
    resizing.el.style.width  = resizing.tile.width  + 'px';
    resizing.el.style.height = resizing.tile.height + 'px';
  }
});


// ─── MOUSE UP ─────────────────────────────────────────────────────────────────
// End any active drag or resize, then save the updated positions.

document.addEventListener('mouseup', () => {
  if (dragging || resizing) {
    saveToStorage();
    dragging = null;
    resizing = null;
  }
});


// ─── BRING TO FRONT ───────────────────────────────────────────────────────────
// Clicking a tile makes it appear on top of the others.

function bringToFront(tile, el) {
  tile.z         = zCounter++;
  el.style.zIndex = tile.z;
}


// ─── DELETE TILE ──────────────────────────────────────────────────────────────

function deleteTile(id) {
  tiles = tiles.filter(t => t.id !== id); // Remove from array
  document.getElementById(`tile-${id}`)?.remove(); // Remove from DOM

  if (tiles.length === 0) hint.style.display = 'block'; // Show hint if board is now empty
  saveToStorage();
}


// ─── EXPORT AS PNG ────────────────────────────────────────────────────────────
// We draw all tiles onto a canvas at their exact positions, then trigger a download.
// `async/await` is used here because loading each image takes a tiny moment —
// we need to wait for all of them before we draw.

async function exportBoard() {
  if (tiles.length === 0) return;

  const canvas  = document.createElement('canvas');
  canvas.width  = board.offsetWidth;
  canvas.height = board.offsetHeight;
  const ctx     = canvas.getContext('2d');

  // Fill the background
  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Sort by z-index so tiles overlap correctly in the export
  const sorted = [...tiles].sort((a, b) => a.z - b.z);

  // Load and draw all images — Promise.all waits for every image to finish
  await Promise.all(sorted.map(tile => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height);
      resolve();
    };
    img.src = tile.src;
  })));

  // Trigger a download
  const link      = document.createElement('a');
  link.download   = 'mood-board.png';
  link.href       = canvas.toDataURL('image/png');
  link.click();
}


// ─── LOCALSTORAGE ─────────────────────────────────────────────────────────────
// localStorage only stores strings — never objects or arrays directly.
// JSON.stringify() converts our array to a string: '[{"id":1,"x":40,...}]'
// JSON.parse()     converts it back to a real array when we load the page.

function saveToStorage() {
  try {
    localStorage.setItem('moodboard', JSON.stringify(tiles));
  } catch {
    // This fires if we exceed the ~5 MB localStorage limit
    alert('Storage full — export your board and clear some images to free up space.');
  }
}

function loadFromStorage() {
  const saved = localStorage.getItem('moodboard');
  if (!saved) return;

  tiles = JSON.parse(saved);

  if (tiles.length > 0) {
    hint.style.display = 'none';
    for (const tile of tiles) {
      board.appendChild(renderTile(tile));
    }
    // Restore the z-counter so new tiles appear above existing ones
    zCounter = Math.max(...tiles.map(t => t.z)) + 1;
  }
}
