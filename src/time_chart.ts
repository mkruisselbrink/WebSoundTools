import { LitElement, PropertyValues, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ref, createRef } from 'lit/directives/ref.js';

abstract class LineChartElement extends LitElement {
    @property({type: Number})
    width: number = 1024;
    @property({type: Number})
    height: number = 360;

    @property({type: Number})
    ymin: number = -1;
    @property({type: Number})
    ymax: number = 1;
    @property({type: Number})
    ystep: number = 0.2;
    @property({type: Number})
    xmin: number = 0;
    @property({type: Number})
    xmax: number;

    @property({type: Boolean})
    xislogarithmic: boolean = false;

    xlabels: Array<number> = [];

    padding: number = 16;

    @query('canvas', true)
    canvas: HTMLCanvasElement;

    context: CanvasRenderingContext2D;
    dataArray: Float32Array;
    autoRefreshRef = createRef<HTMLInputElement>();

    constructor() {
        super();
    }

    setDataSize(size: number) {
        this.dataArray = new Float32Array(size);
    }

    abstract refreshData(data: Float32Array): boolean;

    render() {
        const ratio = window.devicePixelRatio;
        return html`
            <canvas
                width=${ratio * this.width}
                height=${ratio * this.height}
                style="width: ${this.width}px; height: ${this.height}px;">
            </canvas><br />
            <button @click="${this.draw}">Refresh</button>
            <input ${ref(this.autoRefreshRef)} 
                type=checkbox 
                id="autoRefreshCheck"
                checked
                @change="${this.draw}"></input>
            <label for="autoRefreshCheck">Auto Refresh</label>
            <number-input label="MinX"></number-input>
        `;
    }

    firstUpdated(changedProperties: PropertyValues<this>) {
        super.firstUpdated(changedProperties);
        this.context = this.canvas.getContext("2d");
        const ratio = window.devicePixelRatio;
        this.context.scale(ratio, ratio);
        this.draw();
    }

    update(changedProperties: PropertyValues<this>) {
        super.update(changedProperties);
        if (this.context) {
            this.context.reset();
            const ratio = window.devicePixelRatio;
            this.context.scale(ratio, ratio);
        }
    }

    abstract getHeightForValue(value: number, height: number): number;
    abstract getPositionForIndex(index: number, width: number): number;
    getValueForIndex(index: number): number {
        return index;
    }

    getXForValue(value: number, width: number): number {
        //console.log(value, this.xmin, this.xmax);
        const pos = this.xislogarithmic ? Math.log(value + 1) : value;
        const minPos = this.xislogarithmic ? Math.log(this.xmin + 1) : this.xmin;
        const maxPos = this.xislogarithmic ? Math.log(this.xmax + 1) : this.xmax;
        const scale = width / (maxPos - minPos);
        //console.log(pos, minPos, maxPos, scale);
        return scale * (pos - minPos);
        //const logPos = Math.log10(index + 1);
        //const scale = width / Math.log10(this.analyser.frequencyBinCount);
        //return scale * logPos;
    }

    draw() {
        if (this.autoRefreshRef.value.checked) {
            requestAnimationFrame(() => { this.draw() });
        }

        const yAxisTextWidth = 64;
        const xAxisTextHeight = 24;
        const WIDTH = this.width - yAxisTextWidth - 2 * this.padding;
        const HEIGHT = this.height - 2 * this.padding - xAxisTextHeight;

        if (!this.refreshData(this.dataArray)) {
            return;
        }

        this.context.save();
        this.context.translate(this.padding, this.padding);

        this.context.fillStyle = "rgb(0, 0, 0)";
        this.context.font = "16px Helvetica";
        this.context.textAlign = "right";
        this.context.textBaseline = "middle";
        this.context.lineWidth = 0;
        const ydecimals = this.ystep < 1 ? 1 : 0;
        const ylabels = [this.ymin, 0, this.ymax];
        for (let y = -this.ystep; y > this.ymin; y -= this.ystep) {
            ylabels.push(y);
        }
        for (let y = this.ystep; y < this.ymax; y += this.ystep) {
            ylabels.push(y);
        }

        for (let value of ylabels) {
            const y = this.getHeightForValue(value, HEIGHT);
            this.context.fillText(value.toFixed(ydecimals), yAxisTextWidth - 8, y, yAxisTextWidth);
        }
        this.context.textAlign = "center";
        this.context.textBaseline = "alphabetic";
        for (let value of this.xlabels) {
            const x = this.getXForValue(value, WIDTH);
            this.context.fillText(value.toFixed(0), x + yAxisTextWidth, HEIGHT + 20);
        }

        this.context.beginPath();
        this.context.fillStyle = "rgb(255, 255, 255)";
        this.context.rect(yAxisTextWidth, 0, WIDTH, HEIGHT);
        this.context.fill();
        this.context.lineWidth = 1.0;
        this.context.strokeStyle = "rgb(127, 127, 127)";
        for (let value of ylabels) {
            const y = this.getHeightForValue(value, HEIGHT);
            this.context.beginPath();
            this.context.moveTo(yAxisTextWidth, y);
            this.context.lineTo(WIDTH + yAxisTextWidth, y);
            this.context.stroke();
        }
        for (let value of this.xlabels) {
            const x = this.getXForValue(value, WIDTH);
            this.context.beginPath();
            this.context.moveTo(x + yAxisTextWidth, 0);
            this.context.lineTo(x + yAxisTextWidth, HEIGHT);
            this.context.stroke();
        }

        this.context.beginPath();
        this.context.rect(yAxisTextWidth, 0, WIDTH, HEIGHT);
        this.context.clip();

        this.context.lineWidth = 1.5;
        this.context.strokeStyle = "rgb(0, 150, 250)";
        this.context.beginPath();

        for (let i = 0; i < this.dataArray.length; i++) {
            const x = yAxisTextWidth + this.getXForValue(this.getValueForIndex(i), WIDTH);
            const y = this.getHeightForValue(this.dataArray[i], HEIGHT);

            if (i === 0) {
                this.context.moveTo(x, y);
            } else {
                this.context.lineTo(x, y);
            }
        }
        this.context.stroke();

        this.context.restore();
    }
}

@customElement('time-chart')
export class TimeChartElement extends LineChartElement {
    analyser: AnalyserNode;

    constructor() {
        super();
        this.ymin = -1;
        this.ymax = 1;
    }

    setAnalyserNode(analyser: AnalyserNode) {
        this.analyser = analyser;
        this.setDataSize(analyser.fftSize);
        this.xmax = analyser.fftSize;
    }

    refreshData(data: Float32Array): boolean {
        if (!this.analyser) {
            return false;
        }
        this.analyser.getFloatTimeDomainData(data);
        return true;
    }

    getHeightForValue(value: number, height: number): number {
        const v = -value * height / 2;
        const y = height / 2 + v;
        return y;
    }

    getPositionForIndex(index: number, width: number): number {
        const sliceWidth = 16 * (width * 1.0) / this.analyser.fftSize;
        return sliceWidth * index;
    }
}

@customElement('frequency-chart')
export class FrequencyChartElement extends LineChartElement {
    analyser: AnalyserNode;
    minDb: number = -180;
    maxDb: number = 40;

    constructor() {
        super();
        this.ymin = this.minDb;
        this.ymax = this.maxDb;
        this.ystep = 30;
        this.xmin = 20;
        this.xmax = 20000;
        this.updateXLabels();
        this.xislogarithmic = true;
    }

    updateXLabels() {
        let l = [];
        for (let f = 1000; f > this.xmin; f /= 2) {
            l.push(f);
        }
        for (let f = 2000; f < this.xmax; f *= 2) {
            l.push(f);
        }
        this.xlabels = l.sort((a, b) => { return a - b; });
    }

    setAnalyserNode(analyser: AnalyserNode) {
        this.analyser = analyser;
        this.setDataSize(analyser.frequencyBinCount);
    }

    refreshData(data: Float32Array): boolean {
        if (!this.analyser) {
            return false;
        }
        this.analyser.getFloatFrequencyData(data);
        return true;
    }

    getHeightForValue(value: number, height: number): number {
        const scale = height / (this.maxDb - this.minDb);
        return height - (scale * (value - this.minDb));
        //return height - (value + 180);
    }

    getPositionForIndex(index: number, width: number): number {
        const logPos = Math.log10(index + 1);
        const scale = width / Math.log10(this.analyser.frequencyBinCount);
        return scale * logPos;
    }
    getValueForIndex(index: number): number {
        const ratio = (this.analyser.context.sampleRate / 2) / this.analyser.frequencyBinCount;
        return ratio * index;
    }
}
