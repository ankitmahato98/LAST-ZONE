import { createGame } from './core/engine.js';
import './styles/main.css';

/**
 * LAST ZONE entry point.
 *
 * Boot sequence: create the game -> load the world -> show the menu -> the
 * player presses Play -> the simulation starts.
 */
const bootStatus = document.getElementById('boot-status');

function fatal(error) {
  console.error('[last-zone] fatal error', error);
  const target = document.getElementById('boot') ?? document.body;
  target.innerHTML = `
    <div class="fatal">
      <h1>LAST ZONE failed to start</h1>
      <p>${String(error?.message ?? error)}</p>
      <p>Check the browser console for the full stack trace. WebGL 2 is required.</p>
    </div>`;
  target.classList?.remove('boot--hidden');
}

function setStatus(text) {
  if (bootStatus) bootStatus.textContent = text;
}

async function main() {
  setStatus('Building the world\u2026');

  const { game, loading } = await createGame();
  window.LAST_ZONE = { game }; // handy for debugging from the console

  setStatus('Warming up shaders\u2026');
  await loading.warmup(game);

  game.start();
  setStatus('Ready.');
  await loading.hide();

  game.bus.emit('app:booting-done', { game });
}

main().catch(fatal);

// Surface unhandled async failures in the same place as boot failures.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[last-zone] unhandled rejection', event.reason);
});
