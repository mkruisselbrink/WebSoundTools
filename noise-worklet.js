
class WhiteNoiseGenerator extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const output = outputs[0];
      output.forEach((channel) => {
        for (let i = 0; i < channel.length; i++) {
          channel[i] = Math.random() * 2 - 1;
        }
      });
      return true;
    }
}
  
registerProcessor("white-noise", WhiteNoiseGenerator);

const RANDOM_BITS = 24;
const RANDOM_SHIFT = 8;

let randSeed = 22222;
function pseudoRandom() {
    randSeed = ((randSeed * 196314165) + 907633515) & 0xffffffff;
    return randSeed >> RANDOM_SHIFT;
}


class PinkNoiseGenerator extends AudioWorkletProcessor {
    constructor() {
        super();
        this.numRows = 12;
        this.rows = new Int32Array(this.numRows);
        this.indexMask = (1 << this.numRows) - 1;
        this.index = 0;
        this.runningSum = 0;
        let pmax = (this.numRows + 1) * (1 << (RANDOM_BITS - 1));
        this.scalar = 1.0 / pmax;
    
    }
  
    process(inputs, outputs, parameters) {
      const output = outputs[0];
      for (let i = 0; i < output[0].length; ++i) {
        // Increment and mask index.
        this.index = (this.index + 1) & this.indexMask;

        if (this.index != 0) {
            let numZeros = 0;
            let n = this.index;
            while ((n & 1) == 0) {
                n = n >> 1;
                numZeros++;
            }

            this.runningSum -= this.rows[numZeros];
            let newRandom = pseudoRandom();
            this.runningSum += newRandom;
            this.rows[numZeros] = newRandom;
        }

        let newRandom = pseudoRandom();
        let sum = this.runningSum + newRandom;

        let out = sum * this.scalar;
        for (let channel = 0; channel < output.length; ++channel) {
            output[channel][i] = out;
        }
      }  
      return true;
    }
  }
  
  registerProcessor('pink-noise', PinkNoiseGenerator);