/**
 * Sky Combat — entry point.
 *
 * Boots the interface, starts the 3D view and handles the two outcomes: the menu,
 * or the failure panel when the browser cannot give us a WebGL context.
 */
import './styles/main.css';
import './styles/screens.css';
import { Game } from './game/Game.js';
import { FatalPanel } from './ui/FatalPanel.js';
import { Loading } from './ui/Loading.js';
import { MainMenu } from './ui/MainMenu.js';
import { PerfReadout } from './ui/PerfReadout.js';

const canvas = document.getElementById('viewport');
const ui = document.getElementById('ui');
const params = new URLSearchParams(window.location.search);

/** Let the browser paint the loading text between the heavier steps. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const loading = new Loading(ui);
const perf = new PerfReadout(ui);

let game = null;
let menu = null;

function startFlight() {
  if (!game) return;
  menu?.hide();
  if (!game.start()) {
    // Already flying or paused: just make sure the menu is out of the way.
    game.resume();
  }
}

function showMenu() {
  game?.toMenu();
  menu?.show();
}

async function boot() {
  try {
    loading.set('Checking the 3D view…', 0.1);
    await nextFrame();

    game = new Game({ canvas });

    loading.set('Painting the sky and the sea…', 0.35);
    await nextFrame();
    await game.init();

    loading.set('Rolling out the airframe…', 0.9);
    await nextFrame();

    menu = new MainMenu(ui, { onStart: startFlight });
    menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
    menu.setStatus(`Quality: ${game.tier}`);

    game.on('frame', (telemetry) => perf.update(telemetry));

    // `?cover` gives the cover renderer a still, level aircraft to photograph.
    if (params.has('cover')) game.demo = false;
    if (params.has('perf')) perf.toggle(true);

    loading.hide();

    /*
     * Automation surface, used by tests/smoke.mjs and tools/cover.mjs. These are
     * read-only helpers plus the same calls the buttons make; nothing here changes
     * how the game behaves on its own.
     */
    window.__sky = {
      get game() {
        return game;
      },
      get ready() {
        return Boolean(game);
      },
      start: startFlight,
      menu: showMenu,
      telemetry: () => game?.telemetry(),
      showPerf: (on) => perf.toggle(on),
      setDemo: (enabled) => {
        if (game) game.demo = enabled;
      },
      hideMenu: () => menu?.hide(),
      /** Release the renderer and every generated texture. Used by the acceptance check. */
      dispose: () => game?.dispose(),
    };
  } catch (error) {
    console.error('[SkyCombat] could not start', error);
    loading.hide();
    new FatalPanel(ui, { detail: error?.message ? String(error.message) : null });
  }
}

boot();
