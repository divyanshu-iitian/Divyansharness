export function secondsToMilliseconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Expected non-negative seconds');
  return seconds * 100;
}
