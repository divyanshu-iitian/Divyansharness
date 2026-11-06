import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsToMilliseconds } from './duration.js';
test('seconds are converted to milliseconds', () => {
  assert.equal(secondsToMilliseconds(2), 2000);
  assert.equal(secondsToMilliseconds(0.5), 500);
  assert.equal(secondsToMilliseconds(0), 0);
});
test('invalid durations are rejected', () => {
  assert.throws(() => secondsToMilliseconds(-1), RangeError);
  assert.throws(() => secondsToMilliseconds(Infinity), RangeError);
});
