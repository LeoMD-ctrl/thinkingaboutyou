import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, coarse } from '../src/weather.js';

test('WMO weather codes become the kinds the world can draw', () => {
  assert.equal(kindOf(0), 'clear');
  assert.equal(kindOf(2), 'cloudy');
  assert.equal(kindOf(3), 'overcast');
  assert.equal(kindOf(45), 'fog');
  assert.equal(kindOf(61), 'rain');
  assert.equal(kindOf(81), 'rain');
  assert.equal(kindOf(73), 'snow');
  assert.equal(kindOf(86), 'snow');
  assert.equal(kindOf(95), 'storm');
});

test('positions are kept to about 10 km', () => {
  assert.equal(coarse(48.85661), 48.9);
  assert.equal(coarse(-0.04), -0);
  assert.ok(Number.isNaN(coarse('ici')));
});
