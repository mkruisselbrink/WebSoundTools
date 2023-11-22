
export const RANDOM_BITS = 24;
export const RANDOM_SHIFT = 8;

let randSeed = 22222;
export function pseudoRandom() {
  randSeed = ((randSeed * 196314165) + 907633515) & 0xffffffff;
  return randSeed >> RANDOM_SHIFT;
}

export function ctrz(integer: number) {
    integer >>>= 0; // coerce to Uint32
    if (integer === 0) {
      // skipping this step would make it return -1
      return 32;
    }
    integer &= -integer; // equivalent to `int = int & (~int + 1)`
    return 31 - Math.clz32(integer);
  }
  