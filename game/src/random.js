// A tiny seeded RNG (mulberry32) so the same seed builds the same city.
// Screenshots and test runs stay repeatable; gameplay randomness comes
// from this generator and nowhere else.
export function createRandom(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rand, lo, hi) {
  return lo + rand() * (hi - lo);
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

export function shuffle(rand, list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}
