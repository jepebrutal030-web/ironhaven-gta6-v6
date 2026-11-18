// Keyboard and mouse state. Held keys are a live set; single presses are
// queued and consumed exactly once, so a tap that lands between two slow
// headless frames is never lost and never double-counted.
export function createInput(canvas) {
  const held = new Set();
  const queue = [];
  let lookX = 0;
  let lookY = 0;
  let mouseDown = false;
  let dragging = false;

  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space',
    'KeyE', 'KeyR', 'KeyP', 'KeyM', 'Digit1', 'Digit2', 'Digit3',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]);

  window.addEventListener('keydown', (event) => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    held.add(event.code);
    if (!event.repeat) queue.push(event.code);
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
    dragging = false;
  });

  canvas.addEventListener('mousedown', (event) => {
    mouseDown = true;
    dragging = true;
    if (canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* pointer lock is a nicety, not a requirement */ }
    }
    event.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    mouseDown = false;
    dragging = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas || dragging) {
      lookX += event.movementX || 0;
      lookY += event.movementY || 0;
    }
  });

  return {
    down(code) {
      return held.has(code);
    },
    // Take one queued press of this code, if any happened since the last
    // frame. One physical tap is one press, however slow the frames.
    wasPressed(code) {
      const i = queue.indexOf(code);
      if (i === -1) return false;
      queue.splice(i, 1);
      return true;
    },
    // Throw away every queued press (called once per frame by the game).
    drainQueue() {
      queue.length = 0;
    },
    takeMouse() {
      const dx = lookX;
      const dy = lookY;
      lookX = 0;
      lookY = 0;
      return { dx, dy };
    },
    isMouseDown() {
      return mouseDown;
    },
    axis() {
      let x = 0;
      let z = 0;
      if (held.has('KeyW') || held.has('ArrowUp')) z -= 1;
      if (held.has('KeyS') || held.has('ArrowDown')) z += 1;
      if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
      return { x, z };
    },
    sprint() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
  };
}
