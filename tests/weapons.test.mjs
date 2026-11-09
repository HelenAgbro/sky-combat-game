/**
 * Sky Combat — unit tests for the weapon shop: the central weapon table, the resolved
 * firing spec, and the progression rules that gate unlocking, upgrading, equipping and
 * spending.
 *
 * Pure — no DOM, no renderer — so it runs in plain Node.
 *
 *   npm run test:unit
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEAPON_ID,
  WEAPON_IDS,
  WEAPON_KINDS,
  WEAPONS,
  getWeapon,
  resolveWeapon,
} from '../src/data/weapons.js';
import { Progression, parseProgression, sanitiseWeapons } from '../src/run/progression.js';

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

/* ---------------------------------------------------------------- data */

test('there are four arcade weapons, all distinct and complete', () => {
  assert.deepEqual(WEAPON_IDS, ['standard', 'spread', 'laser', 'homing']);
  assert.equal(DEFAULT_WEAPON_ID, 'standard');

  for (const weapon of WEAPONS) {
    assert.ok(WEAPON_KINDS.includes(weapon.kind), `${weapon.id} kind is known`);
    assert.ok(weapon.name && weapon.description, `${weapon.id} is described`);
    assert.equal(typeof weapon.price, 'number');
    assert.ok(weapon.price >= 0);
    assert.ok(Array.isArray(weapon.levels) && weapon.levels.length >= 1, `${weapon.id} has levels`);
  }

  assert.equal(WEAPONS.find((w) => w.id === 'standard').price, 0, 'the standard gun is free');
});

test('each weapon level defines the numbers its kind needs', () => {
  for (const weapon of WEAPONS) {
    for (const level of weapon.levels) {
      assert.ok(level.cooldown > 0, `${weapon.id} cooldown`);
      assert.ok(level.damage > 0, `${weapon.id} damage`);
      if (weapon.kind !== 'laser') {
        assert.ok(level.speed > 0, `${weapon.id} speed`);
        assert.ok(level.lifespan > 0, `${weapon.id} lifespan`);
      } else {
        assert.ok(level.range > 0, `${weapon.id} range`);
      }
    }
    if (weapon.kind === 'spread') {
      assert.ok(weapon.levels.every((level) => level.count > 1), 'spread fires several pellets');
    }
    if (weapon.kind === 'homing') {
      assert.ok(weapon.levels.every((level) => level.turnRate > 0), 'homing rounds steer');
    }
  }
});

test('resolveWeapon flattens a level and clamps the index', () => {
  const base = resolveWeapon('laser', 0);
  assert.equal(base.kind, 'laser');
  assert.equal(base.level, 0);
  assert.equal(base.range, WEAPONS.find((w) => w.id === 'laser').levels[0].range);

  const top = resolveWeapon('laser', 99);
  const max = WEAPONS.find((w) => w.id === 'laser').levels.length - 1;
  assert.equal(top.level, max);

  assert.equal(resolveWeapon('laser', -3).level, 0, 'a negative level clamps to the base');
  assert.equal(getWeapon('not-a-weapon').id, 'standard', 'an unknown id falls back');
});

test('weapon progression sanitises junk into the standard gun', () => {
  const parsed = parseProgression({
    weapons: {
      unlocked: ['homing', 'nope'],
      levels: { standard: 99, laser: -2, homing: 'x' },
      selected: 'laser',
    },
  });

  assert.deepEqual(parsed.weapons.unlocked, ['standard', 'homing']);
  assert.equal(
    parsed.weapons.levels.standard,
    WEAPONS.find((w) => w.id === 'standard').levels.length - 1,
  );
  assert.equal(parsed.weapons.levels.laser, 0, 'a locked weapon reads as level 0');
  assert.equal(parsed.weapons.selected, 'standard', 'a selected locked weapon falls back');
  assert.deepEqual(sanitiseWeapons('nope').unlocked, ['standard']);
});

test('the standard gun is always owned; everything else starts locked', () => {
  const progression = new Progression(memoryStore());
  assert.equal(progression.isWeaponUnlocked('standard'), true);
  assert.equal(progression.isWeaponUnlocked('laser'), false);
  assert.equal(progression.weaponSelected, 'standard');
  assert.equal(progression.weaponLevel('standard'), 0);
});

test('unlocking spends the price once, and a poor wallet fails safely', () => {
  const store = memoryStore();
  const progression = new Progression(store);
  const laser = WEAPONS.find((w) => w.id === 'laser');

  assert.equal(progression.unlockWeapon('laser'), false, 'nothing in the bank');
  progression.addCoins(laser.price - 1);
  assert.equal(progression.unlockWeapon('laser'), false, 'one coin short is still short');

  progression.addCoins(1);
  assert.equal(progression.unlockWeapon('laser'), true);
  assert.equal(progression.coins, 0);
  assert.equal(progression.isWeaponUnlocked('laser'), true);
  assert.equal(progression.unlockWeapon('laser'), false, 'an unlocked weapon is not bought twice');
});

test('upgrades climb one level at a time and stop at the top', () => {
  const store = memoryStore();
  const progression = new Progression(store);
  const standard = WEAPONS.find((w) => w.id === 'standard');

  assert.equal(progression.weaponLevel('standard'), 0);
  assert.equal(progression.upgradeWeapon('laser'), false, 'a locked weapon cannot upgrade');

  let total = 0;
  for (const level of standard.levels) total += level.cost;
  progression.addCoins(total);

  const steps = standard.levels.length - 1;
  for (let i = 0; i < steps; i += 1) {
    assert.equal(progression.upgradeWeapon('standard'), true, `level ${i + 1}`);
    assert.equal(progression.weaponLevel('standard'), i + 1);
  }
  assert.equal(progression.upgradeWeapon('standard'), false, 'already at max level');
});

test('a locked weapon cannot be equipped; an owned one can', () => {
  const progression = new Progression(memoryStore());
  assert.equal(progression.selectWeapon('homing'), false);
  assert.equal(progression.weaponSelected, 'standard');

  progression.addCoins(WEAPONS.find((w) => w.id === 'spread').price);
  progression.unlockWeapon('spread');
  assert.equal(progression.selectWeapon('spread'), true);
  assert.equal(progression.weaponSelected, 'spread');
});

test('weapon progression persists across a reload', () => {
  const store = memoryStore();
  const first = new Progression(store);
  first.addCoins(WEAPONS.find((w) => w.id === 'spread').price);
  first.unlockWeapon('spread');
  first.selectWeapon('spread');

  const second = new Progression(store);
  assert.equal(second.isWeaponUnlocked('spread'), true);
  assert.equal(second.weaponSelected, 'spread');
});

test('reset returns everything to a first launch', () => {
  const store = memoryStore();
  const progression = new Progression(store);
  progression.addCoins(10000);
  progression.unlock('viper');
  progression.select('viper');
  progression.unlockWeapon('laser');
  progression.selectWeapon('laser');
  progression.upgradeWeapon('laser');

  progression.reset();

  assert.equal(progression.coins, 0);
  assert.equal(progression.selected, 'falcon');
  assert.equal(progression.isUnlocked('viper'), false);
  assert.equal(progression.weaponSelected, 'standard');
  assert.equal(progression.isWeaponUnlocked('laser'), false);
  assert.equal(progression.weaponLevel('laser'), 0);
});