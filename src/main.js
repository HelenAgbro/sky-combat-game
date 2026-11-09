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
import { getWeapon } from './data/weapons.js';
import { AudioManager } from './audio/AudioManager.js';
import { Settings } from './run/settings.js';
import { InputManager } from './systems/InputManager.js';
import { FatalPanel } from './ui/FatalPanel.js';
import { HangarScreen } from './ui/HangarScreen.js';
import { HUD } from './ui/HUD.js';
import { Loading } from './ui/Loading.js';
import { MainMenu } from './ui/MainMenu.js';
import { PauseScreen } from './ui/PauseScreen.js';
import { PerfReadout } from './ui/PerfReadout.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { SettingsScreen } from './ui/SettingsScreen.js';
import { TouchControls, shouldShowTouchControls } from './ui/TouchControls.js';
import { WeaponShopScreen } from './ui/WeaponShopScreen.js';

const canvas = document.getElementById('viewport');
const ui = document.getElementById('ui');
const params = new URLSearchParams(window.location.search);

/** A weapon's display name, for the shop's feedback line. */
const nameOfWeapon = (id) => getWeapon(id).name;

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
let hangar = null;
let shop = null;
let settingsScreen = null;
let touch = null;
let audio = null;
let settingsStore = null;

/** The single place that decides what the player can see. */
function applyScreens(state) {
  const flying = state === STATES.FLYING;
  const paused = state === STATES.PAUSED;
  const finished = state === STATES.RESULTS;
  const inHangar = state === STATES.HANGAR;
  const inShop = state === STATES.SHOP;
  const inSettings = state === STATES.SETTINGS;

  if (flying || paused || finished || inHangar || inShop || inSettings) menu?.hide();
  else menu?.show();

  if (flying || paused) hud?.show();
  else hud?.hide();

  if (paused) pauseScreen?.show();
  else pauseScreen?.hide();

  if (inHangar) hangar?.show();
  else hangar?.hide();

  if (inShop) shop?.show();
  else shop?.hide();

  if (inSettings) settingsScreen?.show();
  else settingsScreen?.hide();

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

/** Open the hangar and draw its current state. */
function openHangar() {
  if (!game || !game.openHangar()) return;
  hangar.render(game.getHangar(), game.telemetry().wallet);
  menu.setWallet(game.telemetry().wallet);
}

/** Open the weapon shop and draw its current state. */
function openShop() {
  if (!game || !game.openShop()) return;
  shop.render(game.getShop(), game.telemetry().wallet);
  menu.setWallet(game.telemetry().wallet);
}

/** Open settings and reflect the stored volume/mute state. */
function openSettings() {
  if (!game || !game.openSettings()) return;
  settingsScreen.render(settingsStore.snapshot());
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

    menu = new MainMenu(ui, { onStart: startFlight, onHangar: openHangar, onShop: openShop, onSettings: openSettings });
    hud = new HUD(ui, { showKeyHint: !wantsTouch });
    pauseScreen = new PauseScreen(ui, {
      onResume: () => game.resume(),
      onRestart: () => {
        game.resume();
        game.start();
      },
      onSettings: openSettings,
      onMenu: () => game.toMenu(),
    });
    results = new ResultsScreen(ui, {
      onRestart: () => game.start(),
      onMenu: () => game.toMenu(),
      onHangar: openHangar,
      onShop: openShop,
    });
    hangar = new HangarScreen(ui, {
      onPreview: (id) => game.previewAircraft(id),
      onSelect: (id) => {
        if (game.selectAircraft(id)) hangar.render(game.getHangar(), game.telemetry().wallet);
      },
      onUnlock: (id) => {
        if (game.unlockAircraft(id)) {
          // Unlocking makes it selectable: select it and redraw with the new wallet.
          game.selectAircraft(id);
          hangar.render(game.getHangar(), game.telemetry().wallet);
          menu.setWallet(game.telemetry().wallet);
        }
      },
      onBack: () => {
        if (game.closeHangar()) {
          menu.setWallet(game.telemetry().wallet);
          menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
        }
      },
    });
    shop = new WeaponShopScreen(ui, {
      onSelect: (id) => {
        if (game.selectWeapon(id)) {
          shop.render(game.getShop(), game.telemetry().wallet);
          shop.flash(`Equipped: ${nameOfWeapon(id)}`);
        }
      },
      onPurchase: (id) => {
        const before = game.getShop().find((weapon) => weapon.id === id);
        if (before?.unlocked) {
          if (game.upgradeWeapon(id)) {
            const level = game.getShop().find((weapon) => weapon.id === id)?.level;
            shop.render(game.getShop(), game.telemetry().wallet);
            menu.setWallet(game.telemetry().wallet);
            shop.flash(`${nameOfWeapon(id)} upgraded to level ${level}`, 'ok');
          } else {
            shop.flash('Already at max level', 'error');
          }
        } else if (game.unlockWeapon(id)) {
          shop.render(game.getShop(), game.telemetry().wallet);
          menu.setWallet(game.telemetry().wallet);
          shop.flash(`${nameOfWeapon(id)} unlocked`, 'ok');
        } else {
          shop.flash('Not enough coins', 'error');
        }
      },
      onBack: () => {
        if (game.closeShop()) {
          menu.setWallet(game.telemetry().wallet);
          menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
        }
      },
    });

    // Audio, settings and the settings panel. Audio is synthesised at runtime and only
    // starts on the first user gesture, so it never fights the browser's autoplay rules.
    settingsStore = new Settings();
    audio = new AudioManager();
    audio.setVolume(settingsStore.volume);
    audio.setMuted(settingsStore.muted);

    settingsScreen = new SettingsScreen(ui, {
      onVolume: (volume) => {
        if (settingsStore.setVolume(volume)) {
          audio.setVolume(volume);
          settingsScreen.render(settingsStore.snapshot());
        }
      },
      onToggleMute: () => {
        const muted = settingsStore.toggleMute();
        audio.setMuted(muted);
        settingsScreen.render(settingsStore.snapshot());
      },
      onBack: () => {
        if (game.closeSettings()) settingsScreen.render(settingsStore.snapshot());
      },
    });

    const unlockAudio = () => {
      audio.unlock();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    if (wantsTouch) createTouchControls();
    else watchForFirstTouch();

    menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
    menu.setStatus(`Quality: ${game.tier}`);
    menu.setBest(game.telemetry().bestDistance);
    menu.setWallet(game.telemetry().wallet);

    game.on('frame', (telemetry) => {
      perf.update(telemetry);
      hud.update(telemetry);

      // The engine bed: live in flight and the menu/hangar/shop backdrop, silent elsewhere.
      const state = game.state.current;
      const simulating =
        state === STATES.FLYING || state === STATES.MENU || state === STATES.HANGAR || state === STATES.SHOP;
      const controller = game.aircraft?.controller;
      if (simulating && controller) {
        audio.updateEngine(controller.throttle ?? 0.6, Boolean(controller.input?.boost));
      } else {
        audio.updateEngine(0, false);
      }
    });

    // The end of a run. `Game` emits this once, with the run's numbers frozen at the moment it
    // ended, and the summary and the menu's record are both filled from it.
    game.on('destroyed', (telemetry) => {
      results.show(telemetry);
      menu.setBest(telemetry.bestDistance);
      menu.setWallet(telemetry.wallet);
      audio.stopEngine();
      audio.gameOver();
    });

    // Sound, wired to the run's events rather than polled, so an effect is never played
    // because of a guessed frame.
    game.combat.on('shoot', (payload) => audio.fire(payload));
    game.combat.on('hit', () => audio.impact('hit'));
    game.combat.on('kill', () => audio.impact('kill'));
    game.combat.on('damage', () => audio.impact('damage'));
    game.on('coin', () => audio.pickup('coin'));
    game.on('powerup', () => audio.pickup('powerup'));
    game.on('refuelled', () => audio.pickup('fuel'));

    // Menu interaction feedback: a quiet blip for every button on every screen.
    document.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('button')) audio.uiClick();
      },
      true,
    );

    game.state.on(applyScreens);
    applyScreens(game.state.current);

    // `?cover` gives the cover renderer a still, level aircraft to photograph.
    if (params.has('cover')) game.demo = false;
    if (params.has('perf')) perf.toggle(true);

    // Development-only: a one-tap way back to a first launch, so progression can be tested
    // repeatedly without clearing storage by hand. Hidden unless the page asks for it.
    if (params.has('dev')) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn ghost dev-reset';
      reset.textContent = 'Reset progression';
      reset.addEventListener('click', () => {
        game.resetProgression();
        menu.setBest(game.telemetry().bestDistance);
        menu.setWallet(game.telemetry().wallet);
        menu.setAircraft(game.aircraft.aircraft.name, game.aircraft.source);
        hangar.render(game.getHangar(), game.telemetry().wallet);
        shop.render(game.getShop(), game.telemetry().wallet);
      });
      ui.append(reset);
    }

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
      /** Hangar automation, for tests and tooling. */
      openHangar,
      hangar: () => game?.getHangar() ?? [],
      selectAircraft: (id) => game?.selectAircraft(id) ?? false,
      unlockAircraft: (id) => game?.unlockAircraft(id) ?? false,
      /** Weapon shop automation, for tests and tooling. */
      openShop,
      shop: () => game?.getShop() ?? [],
      selectWeapon: (id) => game?.selectWeapon(id) ?? false,
      unlockWeapon: (id) => game?.unlockWeapon(id) ?? false,
      upgradeWeapon: (id) => game?.upgradeWeapon(id) ?? false,
      resetProgression: () => game?.resetProgression() ?? false,
      /** Settings automation, for tests and tooling. */
      openSettings,
      settings: () => settingsStore.snapshot(),
      setVolume: (volume) => settingsStore.setVolume(volume),
      toggleMute: () => settingsStore.toggleMute(),
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
        hangar?.dispose();
        shop?.dispose();
        settingsScreen?.dispose();
        menu?.dispose();
        perf.dispose();
        audio?.dispose();
      },
    };
  } catch (error) {
    console.error('[SkyCombat] could not start', error);
    loading.hide();
    new FatalPanel(ui, { detail: error?.message ? String(error.message) : null });
  }
}

boot();
