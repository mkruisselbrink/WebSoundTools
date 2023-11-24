
type AudioGenerator = {
    name: string,
    generator: AudioNode,
    gain: GainNode
}

class GeneratorManager {
    context: AudioContext;
    output: AudioNode;
    generators: Array<AudioGenerator> = [];
    currentGenerator: number = 0;
    select: HTMLSelectElement;

    constructor(context: AudioContext, output: AudioNode, select: HTMLSelectElement) {
        this.context = context;
        this.output = output;
        this.select = select;
        this.select.addEventListener('change', () => {
            this.generatorChanged();
        });
    }

    add(name: string, generator: AudioNode) {
        let gain = new GainNode(this.context);
        generator.connect(gain);
        gain.connect(this.output);
        let index = this.generators.length;
        if (this.currentGenerator == index) {
            gain.gain.setValueAtTime(1, this.context.currentTime);
        } else {
            gain.gain.setValueAtTime(0, this.context.currentTime);
        }
        this.generators.push({
            name: name,
            generator: generator,
            gain: gain
        });
        this.select.add(new Option(name, "" + index, false, index == this.currentGenerator));
    }

    generatorChanged() {
        this.generators[this.currentGenerator].gain.gain.setValueAtTime(0, this.context.currentTime);
        this.currentGenerator = Number(this.select.value);
        this.generators[this.currentGenerator].gain.gain.setValueAtTime(1, this.context.currentTime);
    }
}

let context = new AudioContext();
let mainGain = new GainNode(context);
mainGain.connect(context.destination);
const analyser = context.createAnalyser();
analyser.fftSize = 16384;
mainGain.connect(analyser);

let generators = new GeneratorManager(context, mainGain, document.getElementById("lstGenerators") as HTMLSelectElement);

context.audioWorklet.addModule('dist/noise-worklet.js').then(() => {
    let pinkNoise = new AudioWorkletNode(context, 'pink-noise', { outputChannelCount: [1] });
    generators.add("Pink Noise", pinkNoise);
    let whiteNoise = new AudioWorkletNode(context, 'white-noise', { outputChannelCount: [1] });
    generators.add("White Noise", whiteNoise);

});

let sine = new OscillatorNode(context, {channelCount: 1, frequency: 1000});
sine.start();
generators.add("Sine", sine);

const bufferLength = analyser.frequencyBinCount;
const dataArray = new Float32Array(bufferLength);

//Create 2D canvas
import { TimeChartElement, FrequencyChartElement } from "./src/time_chart.js";

const canvas = new TimeChartElement();
canvas.setAnalyserNode(analyser);
document.body.appendChild(document.createElement("br"));
document.body.appendChild(canvas);

const canvas2 = new FrequencyChartElement();
canvas2.setAnalyserNode(analyser);
document.body.appendChild(document.createElement("br"));
document.body.appendChild(canvas2);

function test() {
    analyser.getFloatFrequencyData(dataArray);
    console.log(dataArray);
    let min = 0;
    let max = 0;
    for (let v of dataArray) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    console.log("Min: ", min, "Max: ", max);
}

document.getElementById("btnStart").onclick = () => {
    context.resume();
}

document.getElementById("btnCapture").onclick = () => {
    test();
}