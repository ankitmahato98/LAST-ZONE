export function createElement(tag, options = {}, children = []) {
  const node = document.createElement(tag);

  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.text != null) node.textContent = String(options.text);
  if (options.html != null) node.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === false || value == null) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (options.style) Object.assign(node.style, options.style);
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      node.addEventListener(event, handler);
    }
  }

  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }

  return node;
}

export function removeElement(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

/** True for touch-first devices (phones/tablets) rather than screen size alone. */
export function isCoarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

/**
 * Pointer lock can be rejected (embedded iframes without `allow="pointer-lock"`,
 * browser UI focus rules, ...). The game degrades to drag-to-look in that case,
 * so a failure must never be fatal - it is reported as `false`.
 */
export async function requestPointerLockSafe(element) {
  if (!element?.requestPointerLock) return false;
  try {
    const result = element.requestPointerLock();
    if (result && typeof result.then === 'function') await result;
    return document.pointerLockElement === element;
  } catch {
    return false;
  }
}

export function exitPointerLockSafe() {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch {
    /* ignore - losing the lock is best effort */
  }
}

/** Resolves on the next animation frame - yields so the UI can paint. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
