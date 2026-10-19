/**
 * Sky Combat — unit tests for the game's content definitions: the four aircraft
 * and the five scenery zones. These are the numbers that drive the airframe
 * builder, the hangar and the shop, so they are checked rather than assumed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AIRCRAFT, DEFAULT_AIRCRAFT_ID, getAircraft } from '../src/data/aircraft.js';
import { DEFAULT_ZONE_ID, ZONES, getZone } from '../src/data/zones.js';

test('there are four distinct aircraft, all complete', () => {
  assert.equal(AIRCRAFT.length, 4);
  assert.deepEqual(
    AIRCRAFT.map((aircraft) => aircraft.id),
    ['falcon', 'viper', 'titan', 'phantom'],
  );
  assert.equal(DEFAULT_AIRCRAFT_ID, 'falcon');

  for (const aircraft of AIRCRAFT) {
    assert.ok(aircraft.name && aircraft.role && aircraft.tagline, `${aircraft.id} is described`);
    assert.equal(typeof aircraft.price, 'number');
    assert.ok(aircraft.price >= 0);

    for (const [key, value] of Object.entries(aircraft.attributes)) {
      assert.ok(value >= 0 && value <= 10, `${aircraft.id} attribute ${key} is 0–10`);
    }
    for (const key of ['paint', 'accent', 'dark', 'glass']) {
      assert.match(aircraft.livery[key], /^#[0-9a-f]{6}$/i, `${aircraft.id} livery.${key}`);
    }

    const { shape } = aircraft;
    assert.ok(shape.length > 10 && shape.length < 25, `${aircraft.id} length is plausible`);
    assert.ok(shape.wing.span > shape.body.width * 2, `${aircraft.id} has real wings`);
    assert.ok(shape.wing.rootChord > shape.wing.tipChord, `${aircraft.id} wing tapers`);
    assert.ok(shape.wing.thickness > 0.03 && shape.wing.thickness < 0.2);
    assert.ok(shape.body.exponent >= 2, `${aircraft.id} body section exponent`);
    assert.ok([1, 2].includes(shape.fins.count), `${aircraft.id} has one or two fins`);
    assert.ok([1, 2].includes(shape.nozzle.count), `${aircraft.id} has one or two nozzles`);
    assert.ok(shape.nozzle.radius > 0.2 && shape.nozzle.radius < 0.8);
    assert.ok(shape.canopy.start < shape.canopy.end, `${aircraft.id} canopy runs forward to aft`);
  }

  assert.equal(new Set(AIRCRAFT.map((a) => a.shape.wing.span)).size, 4, 'spans all differ');
  assert.equal(new Set(AIRCRAFT.map((a) => a.livery.paint)).size, 4, 'paint schemes all differ');
  assert.equal(getAircraft('not-an-aircraft').id, 'falcon', 'an unknown id falls back to the Falcon');
});

test('the first aircraft is free and the rest are earned', () => {
  const [first, ...rest] = AIRCRAFT;
  assert.equal(first.price, 0);
  for (const aircraft of rest) assert.ok(aircraft.price > 0, `${aircraft.id} costs coins`);
});

test('there are five complete scenery zones', () => {
  assert.equal(ZONES.length, 5);
  assert.deepEqual(
    ZONES.map((zone) => zone.id),
    ['coastal', 'mountain', 'desert', 'storm', 'sunset'],
  );
  assert.equal(DEFAULT_ZONE_ID, 'coastal');

  for (const zone of ZONES) {
    assert.ok(zone.name && zone.description, `${zone.id} is described`);
    for (const key of ['zenith', 'horizon', 'haze', 'sun']) {
      assert.match(zone.sky[key], /^#[0-9a-f]{6}$/i, `${zone.id} sky.${key}`);
    }
    assert.match(zone.sea.color, /^#[0-9a-f]{6}$/i);
    assert.match(zone.sea.depth, /^#[0-9a-f]{6}$/i);
    assert.ok(zone.sea.roughness > 0 && zone.sea.roughness <= 1);
    assert.ok(zone.sun.elevation >= 0 && zone.sun.elevation <= 90, `${zone.id} sun elevation`);
    assert.ok(zone.sun.azimuth >= 0 && zone.sun.azimuth <= 360, `${zone.id} sun azimuth`);
    assert.ok(zone.sun.intensity > 0, `${zone.id} sun intensity`);
    assert.ok(zone.fog.far > zone.fog.near, `${zone.id} fog range`);
    assert.match(zone.fog.color, /^#[0-9a-f]{6}$/i);
    assert.ok(zone.exposure > 0.5 && zone.exposure < 2, `${zone.id} exposure`);
  }

  assert.equal(new Set(ZONES.map((zone) => zone.sky.zenith)).size, 5, 'each sky is its own colour');
  assert.equal(getZone('nowhere').id, 'coastal', 'an unknown zone falls back to the coast');
});
