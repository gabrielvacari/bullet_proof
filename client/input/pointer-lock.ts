import { type Aim, INITIAL_AIM, applyMouseDelta } from './aim.ts';

/**
 * Pointer lock lifecycle and the resume overlay (FR-GP-021).
 *
 * A thin shell over the DOM: the aim maths it drives lives in aim.ts, and the key
 * translation in keys.ts, both of which are pure and tested. There is nothing here worth
 * unit-testing that would not amount to testing the browser.
 */
export interface InputSession {
  readonly aim: () => Aim;
  readonly held: () => ReadonlySet<string>;
  readonly locked: () => boolean;
}

export function startInputSession(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
): InputSession {
  let aim: Aim = INITIAL_AIM;
  let held = new Set<string>();
  let locked = false;

  const setLocked = (value: boolean): void => {
    locked = value;
    overlay.hidden = value;
    // Every key is released the moment control is lost. Without this, alt-tabbing away
    // mid-stride leaves the key latched and the player walking on return.
    if (!value) held = new Set<string>();
  };

  canvas.addEventListener('click', () => {
    if (!locked) void canvas.requestPointerLock();
  });
  overlay.addEventListener('click', () => {
    if (!locked) void canvas.requestPointerLock();
  });

  // Fires for Esc, for a browser-initiated exit, and for a denied request alike -- all
  // three must land in the same state.
  document.addEventListener('pointerlockchange', () => {
    setLocked(document.pointerLockElement === canvas);
  });
  document.addEventListener('pointerlockerror', () => {
    setLocked(false);
  });

  document.addEventListener('mousemove', (event: MouseEvent) => {
    // Deltas accumulated while unlocked are discarded, not queued: applying them on
    // resume would snap the camera by however far the cursor happened to travel.
    if (!locked) return;
    aim = applyMouseDelta(aim, event.movementX, event.movementY);
  });

  globalThis.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!locked) return;
    held.add(event.code);
  });
  globalThis.addEventListener('keyup', (event: KeyboardEvent) => {
    held.delete(event.code);
  });
  globalThis.addEventListener('blur', () => {
    held = new Set<string>();
  });

  setLocked(false);

  return { aim: () => aim, held: () => held, locked: () => locked };
}
