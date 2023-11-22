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
analyser.fftSize = 2048;
mainGain.connect(analyser);

let generators = new GeneratorManager(context, mainGain, document.getElementById("lstGenerators") as HTMLSelectElement);

let sine = new OscillatorNode(context, {channelCount: 1});
sine.start();
generators.add("Sine", sine);

context.audioWorklet.addModule('dist/noise-worklet.js').then(() => {
    let pinkNoise = new AudioWorkletNode(context, 'pink-noise', { outputChannelCount: [1] });
    generators.add("Pink Noise", pinkNoise);
    let whiteNoise = new AudioWorkletNode(context, 'white-noise', { outputChannelCount: [1] });
    generators.add("White Noise", whiteNoise);

});

const bufferLength = analyser.frequencyBinCount;
const dataArray = new Float32Array(bufferLength);

//Create 2D canvas
const canvas = document.createElement("canvas");
canvas.style.position = "absolute";
canvas.style.top = "32";
canvas.style.left = "0";
canvas.width = 1024;//window.innerWidth;
canvas.height = 256;//window.innerHeight;
document.body.appendChild(canvas);
const canvasCtx = canvas.getContext("2d");
canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

function draw() {
    //let drawVisual = requestAnimationFrame(draw);

    const WIDTH = 1024;
    const HEIGHT = 256;
    analyser.getFloatTimeDomainData(dataArray);

    canvasCtx.fillStyle = "rgb(200, 200, 200)";
    canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(0, 0, 0)";
    canvasCtx.beginPath();

    const sliceWidth = (WIDTH * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] * HEIGHT / 2;
        const y = HEIGHT / 2 + v;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
}
draw();

function test() {
    analyser.getFloatTimeDomainData(dataArray);
    console.log(dataArray);
    let min = 0;
    let max = 0;
    for (let v of dataArray) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    console.log("Min: ", min, "Max: ", max);
    draw();
}

document.getElementById("btnStart").onclick = () => {
    context.resume();
}

document.getElementById("btnCapture").onclick = () => {
    test();
}