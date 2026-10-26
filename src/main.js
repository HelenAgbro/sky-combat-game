/**
 * Sky Combat — entry point.
 *
 * Boots the interface, starts the 3D view and wires the input systems to the game:
 * the keyboard through `InputManager`, the on-screen controls through
 * `TouchControls`, and one place that maps the game state onto what is on show.
 */
import './styles/main.css';
import './styles/screens.css';
import './styles/hud.css';
import { Game } from './game/Game.js';
import { STATES } from './game/GameState.js';
import { InputManager } from './systems/InputManager.js';
import { FatalPanel } from './ui/FatalPanel.js';
import { HUD } from './ui/HUD.js';
import { Loading } from './ui/Loading.js';
import { MainMenu } from './ui/MainMenu.js';
import { PauseScreen } from './ui/PauseScreen.js';
import { PerfReadout } from './ui/PerfReadout.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { TouchControls, shouldShowTouchControls } from './ui/TouchControls.js';

const canvas = document.getElementById('viewport');
const ui = document.getElementById('ui');
const params = new URLSearchParams(window.location.search);

/** Let the browser paint the loading text between the heavier steps. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const loading = new Loading(ui);
const perf = new PerfReadout(ui);
const input = new InputManager();

let game = null;
let menu = null;
let hud = null;
let pauseScreen = null;
let results = null;
let touch = null;

/** The single place that decides what the player can see. */
function applyScreens(state) {
  const flying = state === STATES.FLYING;
  const paused = state === STATES.PAUSED;
  const finished = state === STATES.RESULTS;

  if (flying || paused || finished) menu?.hide();
  else menu?.show();

  if (flying || paused) hud?.show();
  else hud?.hide();

  if (paused) pauseScreen?.show();
  else pauseScreen?.hide();

  if (!finished) results?.hide();

  // The touch controls stay up while paused: their pause button is how a touch
  // player gets going again.
  if (flying || paused) touch?.show();
  else touch?.hide();
}

function startFlight() {
  if (!game) return;
  if (!game.start()) game.resume();
}

function showMenu() {
  game?.toMenu();
}

/** Build the on-screen controls. Called at boot, or on the first real touch. */
function createTouchControls() {
  touch = new TouchControls(ui, {
    onChange: (state) => input.setTouchState(state),
    onPause: () => game?.togglePause(),
  });
  touch.attach();
  applyScreens(game?.state.current ?? STATES.MENU);
}

/**
 * A laptop with a touchscreen reports a fine pointer at startup, so the on-screen
 * controls appear the first time the player actually uses a finger.
 */
function watchForFirstTouch() {
  const reveal = (event) => {
    if (event.pointerType !== 'touch' || touch) return;
    window.removeEventListener('pointerdown', reveal);
    createTouchControls();
  };
  window.addEventListener('pointerdown', reveal, { passive: true });
}

async function boot() {
  try {
    loading.set('Checking the 3D view…', 0.1);
    await nextFrame();

    // The keyboard is live before the scene exists, so a key pressed during loading
    // is already held when the flight starts.
    input.attach();
    game = new Game({ canvas, input });

    loading.set('Painting the sky and the sea…', 0.35);
    await nextFrame();
    await game.init();

    loading.set('Rolling out the airframe…', 0.9);
    await nextFrame();

    const wantsTouch = shouldShowTouchControls(params);

    menu = new MainMenu(ui, { onStart: startFlight });
    hud = new HUD(ui, { showKeyHint: !wantsTouch });
    pauseScreen = new PauseScreen(ui, {
      onResume: () => game.resume(),
      onRestart: () => {
        game.resume();
        game.start();
      },
      onMenu: () => game.toMenu(),
    });
    results = new ResultsScreen(ui, {
      onRestart: () => game.start(),
      onMenu: () => game.toMenu(),
    });

    if (wantsTouch) createTouchControls();
    else watchForFirstTouch();

    menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
    menu.setStatus(`Quality: ${game.tier}`);
    menu.setBest(game.telemetry().bestDistance);

    game.on('frame', (telemetry) => {
      perf.update(telemetry);
      hud.update(telemetry);
    });

    // The end of a run. `Game` emits this once, with the run's numbers frozen at the moment it
    // ended, and the summary and the menu's record are both filled from it.
    game.on('destroyed', (telemetry) => {
      results.show(telemetry);
      menu.setBest(telemetry.bestDistance);
    });

    game.state.on(applyScreens);
    applyScreens(game.state.current);

    // `?cover` gives the cover renderer a still, level aircraft to photograph.
    if (params.has('cover')) game.demo = false;
    if (params.has('perf')) perf.toggle(true);

    loading.hide();

    /*
     * Automation surface, used by tests/smoke.mjs, tests/acceptance.mjs and
     * tools/cover.mjs. These are read-only helpers plus the same calls the buttons
     * make; nothing here changes how the game behaves on its own.
     */
    window.__sky = {
      get game() {
        return game;
      },
      get ready() {
        return Boolean(game);
      },
      get controls() {
        return input.read();
      },
      start: startFlight,
      menu: showMenu,
      telemetry: () => game?.telemetry(),
      showPerf: (on) => perf.toggle(on),
      setDemo: (enabled) => {
        if (game) game.demo = enabled;
      },
      hideMenu: () => menu?.hide(),
      /** Move to another scenery zone. See docs/SCENERY.md. */
      setZone: (id, options) => game?.setZone(id, options),
      /** Release the renderer, the input listeners and every generated texture. */
      dispose: () => {
        game?.dispose();
        input.dispose();
        touch?.dispose();
        hud?.dispose();
        pauseScreen?.dispose();
        results?.dispose();
        menu?.dispose();
        perf.dispose();
      },
    };
  } catch (error) {
    console.error('[SkyCombat] could not start', error);
    loading.hide();
    new FatalPanel(ui, { detail: error?.message ? String(error.message) : null });
  }
}

boot();
