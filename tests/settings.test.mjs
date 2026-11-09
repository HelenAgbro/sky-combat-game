/**
 * Sky Combat — unit tests for the settings store and the settings screen's state machine.
 *
 * Pure — no DOM, no renderer — so it runs in plain Node.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GameState, STATES } from '../src/game/GameState.js';
import {
  DEFAULT_VOLUME,
  SETTINGS_KEY,
  Settings,
  readSettings,
  sanitiseSettings,
} from '../src/run/settings.js';

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('settings sanitise junk into the defaults', () => {
  assert.deepEqual(sanitiseSettings(null), { volume: DEFAULT_VOLUME, muted: false });
  assert.deepEqual(sanitiseSettings('nope'), { volume: DEFAULT_VOLUME, muted: false });
  assert.deepEqual(sanitiseSettings({ volume: 4, muted: 'yes' }), { volume: 1, muted: false });
  assert.deepEqual(sanitiseSettings({ volume: -1, muted: true }), { volume: 0, muted: true });

  const junk = memoryStore({ [SETTINGS_KEY]: '{{bad json' });
  assert.deepEqual(readSettings(junk), { volume: DEFAULT_VOLUME, muted: false });
});

test('volume is clamped and mute toggles and both persist', () => {
  const store = memoryStore();
  const settings = new Settings(store);

  assert.equal(settings.volume, DEFAULT_VOLUME);
  assert.equal(settings.muted, false);

  settings.setVolume(2);
  assert.equal(settings.volume, 1, 'volume clamps to 1');

  settings.setVolume(0.35);
  assert.equal(settings.toggleMute(), true);
  assert.equal(settings.muted, true);

  const reloaded = new Settings(store);
  assert.equal(reloaded.volume, 0.35);
  assert.equal(reloaded.muted, true);
});

test('the settings screen is reachable from the menu and pause, and not mid-flight', () => {
  const state = new GameState(STATES.BOOT);
  state.set(STATES.LOADING);
  state.set(STATES.MENU);

  assert.equal(state.set(STATES.SETTINGS), true, 'the menu opens settings');
  assert.equal(state.set(STATES.MENU), true, 'settings returns to the menu');

  state.set(STATES.FLYING);
  assert.equal(state.can(STATES.SETTINGS), false, 'a live flight cannot jump straight to settings');
  state.set(STATES.PAUSED);

  assert.equal(state.set(STATES.SETTINGS), true, 'pause opens settings');
  assert.equal(state.set(STATES.PAUSED), true, 'settings returns to pause');
  assert.equal(state.previous, STATES.SETTINGS);
});