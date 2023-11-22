import * as Utils from "./utils.js";

class WhiteNoiseGenerator extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const output = outputs[0];
    output.forEach((channel) => {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = 0.7 * (Math.random() * 2 - 1);
      }
    });
    return true;
  }
}

registerProcessor("white-noise", WhiteNoiseGenerator);

class PinkNoiseGenerator extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  numRows: number = 12;
  rows: Int32Array;
  indexMask: number;
  index: number = 0;
  runningSum: number = 0;
  scalar: number;

  constructor() {
    super();
    this.rows = new Int32Array(this.numRows);
    this.indexMask = (1 << this.numRows) - 1;
    let pmax = (this.numRows + 1) * (1 << (Utils.RANDOM_BITS - 1));
    this.scalar = 1.0 / pmax;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const output = outputs[0];
    for (let i = 0; i < output[0].length; ++i) {
      this.index = (this.index + 1) & this.indexMask;

      if (this.index != 0) {
        let numZeros = Utils.ctrz(this.index);
        this.runningSum -= this.rows[numZeros];
        let newRandom = Utils.pseudoRandom();
        this.runningSum += newRandom;
        this.rows[numZeros] = newRandom;
      }

      let newRandom = Utils.pseudoRandom();
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