/**
 * Sky Combat — unit tests for the hangar: the persistent progression (wallet, unlocks and
 * selection), the armour attribute that the flight model gatekeeps, and the hangar's state
 * transitions.
 *
 * Everything here is pure — no DOM, no renderer — so it runs in plain Node.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { armourDamageScale, scaleFromAttributes } from '../src/aircraft/AircraftController.js';
import { AIRCRAFT } from '../src/data/aircraft.js';
import { GameState, STATES } from '../src/game/GameState.js';
import {
  PROGRESSION_KEY,
  Progression,
  parseProgression,
  readProgression,
  sanitiseUnlocked,
} from '../src/run/progression.js';

/** A stand-in for `localStorage`: the same surface, plus the map to look inside. */
function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('progression parses garbage into a safe empty wallet with the Falcon selected', () => {
  for (const bad of [null, undefined, 17, 'nope', '{}']) {
    assert.deepEqual(
      parseProgression(bad),
      { coins: 0, unlocked: ['falcon'], selected: 'falcon' },
      String(bad),
    );
  }

  const junk = memoryStore({ [PROGRESSION_KEY]: '{{not json' });
  assert.deepEqual(readProgression(junk), { coins: 0, unlocked: ['falcon'], selected: 'falcon' });
});

test('a hand-edited store is sanitised rather than trusted', () => {
  const parsed = parseProgression({
    coins: '42.9',
    unlocked: ['viper', 'not-an-aircraft', 'viper'],
    selected: 'phantom',
  });
  assert.equal(parsed.coins, 42);
  assert.deepEqual(parsed.unlocked, ['falcon', 'viper']);
  assert.equal(parsed.selected, 'falcon', 'a selected aircraft that is not unlocked falls back');

  assert.deepEqual(sanitiseUnlocked('nope'), ['falcon']);
});

test('the Falcon is always available and everything else starts locked', () => {
  const progression = new Progression(memoryStore());
  assert.equal(progression.isUnlocked('falcon'), true);
  assert.equal(progression.isUnlocked('viper'), false);
  assert.equal(progression.selected, 'falcon');
});

test('coins are banked as whole numbers and never go negative', () => {
  const progression = new Progression(memoryStore());
  assert.equal(progression.addCoins(7.9), 7, 'a fractional credit is floored');
  assert.equal(progression.addCoins(-5), 7, 'a negative credit is ignored');
  assert.equal(progression.addCoins(Number.NaN), 7);
});

test('unlocking spends the price, and a poor wallet cannot unlock', () => {
  const store = memoryStore();
  const progression = new Progression(store);

  const viper = AIRCRAFT.find((aircraft) => aircraft.id === 'viper');
  assert.equal(progression.unlock('viper'), false, 'cannot unlock with nothing in the bank');

  progression.addCoins(viper.price - 1);
  assert.equal(progression.unlock('viper'), false, 'one coin short is still short');

  progression.addCoins(1);
  assert.equal(progression.unlock('viper'), true);
  assert.equal(progression.coins, 0);
  assert.equal(progression.isUnlocked('viper'), true);

  assert.equal(progression.unlock('viper'), false, 'an unlocked aircraft is not bought twice');
});

test('a locked aircraft cannot be selected', () => {
  const progression = new Progression(memoryStore());
  assert.equal(progression.select('phantom'), false);
  assert.equal(progression.selected, 'falcon', 'the selection is unchanged');

  progression.addCoins(AIRCRAFT.find((aircraft) => aircraft.id === 'phantom').price);
  progression.unlock('phantom');
  assert.equal(progression.select('phantom'), true);
  assert.equal(progression.selected, 'phantom');
});

test('progression persists across a reload and survives a refused write', () => {
  const store = memoryStore();
  const first = new Progression(store);
  first.addCoins(5000);
  first.unlock('viper');
  first.select('viper');

  const second = new Progression(store);
  assert.equal(second.coins, 800, 'viper cost 4200 of the 5000');
  assert.equal(second.isUnlocked('viper'), true);
  assert.equal(second.selected, 'viper');

  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  const session = new Progression(broken);
  session.addCoins(5000);
  session.unlock('viper');
  assert.equal(session.isUnlocked('viper'), true);
  assert.equal(session.coins, 800, 'coins remembered in memory when the store refuses them');
});

test('armour maps to a resistance: higher is tougher, five is the baseline', () => {
  assert.equal(scaleFromAttributes({ armour: 5 }).armour, 1);
  assert.ok(scaleFromAttributes({ armour: 9 }).armour > scaleFromAttributes({ armour: 5 }).armour);
  assert.ok(scaleFromAttributes({ armour: 3 }).armour < 1);
});

test('heavier armour takes less damage per hit', () => {
  const light = armourDamageScale(3);
  const base = armourDamageScale(5);
  const heavy = armourDamageScale(9);

  assert.equal(base, 1, 'the Falcon (armour 5) is the 1.0 baseline');
  assert.ok(heavy < base, 'a Titan takes less than a Falcon');
  assert.ok(light > base, 'a Viper takes more than a Falcon');
  assert.ok(armourDamageScale(0) > 0, 'no division by zero at the floor');
});

test('the hangar is reachable from the menu and the summary, and not from flight', () => {
  const state = new GameState(STATES.BOOT);
  state.set(STATES.LOADING);
  state.set(STATES.MENU);

  assert.equal(state.set(STATES.HANGAR), true, 'the menu opens the hangar');
  assert.equal(state.set(STATES.FLYING), false, 'flying is not entered from the hangar');
  assert.equal(state.set(STATES.MENU), true, 'the hangar returns to the menu');

  state.set(STATES.FLYING);
  assert.equal(state.can(STATES.HANGAR), false, 'a live flight cannot jump to the hangar');
  state.set(STATES.RESULTS);
  assert.equal(state.set(STATES.HANGAR), true, 'the summary can open the hangar');
});