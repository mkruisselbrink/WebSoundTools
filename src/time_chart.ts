
abstract class LineChartElement extends HTMLElement {
    width: number = 1024;
    height: number = 360;

    ymin: number = -1;
    ymax: number = 1;
    ystep: number = 0.2;
    xmin: number = 0;
    xmax: number;
    xislogarithmic: boolean = false;
    xlabels: Array<number> = [];

    padding: number = 16;

    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    dataArray: Float32Array;
    autoRefresh: HTMLInputElement;

    constructor() {
        super();
    }

    setDataSize(size: number) {
        this.dataArray = new Float32Array(size);
    }

    abstract refreshData(data: Float32Array): boolean;

    connectedCallback() {
        const shadow = this.attachShadow({ mode: "open" });

        const ratio = window.devicePixelRatio;
        this.canvas = document.createElement("canvas");
        this.canvas.width = this.width * ratio;
        this.canvas.height = this.height * ratio;
        this.canvas.style.width = this.width + "px";
        this.canvas.style.height = this.height + "px";
        shadow.appendChild(this.canvas);
        shadow.appendChild(document.createElement("br"));

        const refreshButton = document.createElement("button");
        refreshButton.appendChild(document.createTextNode("Refresh"));
        shadow.appendChild(refreshButton)
        shadow.appendChild(document.createTextNode(" "));
        refreshButton.onclick = () => {
            this.draw();
        };
        const autoRefreshCheck = document.createElement("input");
        autoRefreshCheck.type = "checkbox";
        autoRefreshCheck.id = "autoRefreshCheck";
        autoRefreshCheck.checked = true;
        autoRefreshCheck.onchange = () => {
            this.draw();
        };
        this.autoRefresh = autoRefreshCheck;
        shadow.appendChild(autoRefreshCheck);
        const autoRefreshLabel = document.createElement("label");
        autoRefreshLabel.htmlFor = "autoRefreshCheck";
        autoRefreshLabel.appendChild(document.createTextNode("Auto Refresh"));
        shadow.appendChild(autoRefreshLabel);

        this.context = this.canvas.getContext("2d");
        this.context.scale(ratio, ratio);
        this.draw();
    }

    getContext(): CanvasRenderingContext2D {
        return this.canvas.getContext("2d");
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
        if (this.autoRefresh.checked) {
            requestAnimationFrame(() => { this.draw() });
        }

        const yAxisTextWidth = 64;
        const WIDTH = this.width - yAxisTextWidth - 2 * this.padding;
        const HEIGHT = this.height - 2 * this.padding;

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
        this.context.fillStyle = "rgb(0, 0, 0)";
        this.context.textAlign = "center";
        this.context.textBaseline = "alphabetic";
        for (let value of this.xlabels) {
            const x = this.getXForValue(value, WIDTH);
            this.context.fillText(value.toFixed(0), x + yAxisTextWidth, 32);
        }

        this.context.beginPath();
        this.context.rect(yAxisTextWidth, 0, WIDTH, HEIGHT);
        this.context.clip();

        this.context.lineWidth = 1.5;
        this.context.strokeStyle = "rgb(0, 150, 250)";
        this.context.beginPath();

        for (let i = 0; i < this.dataArray.length; i++) {
            const x = yAxisTextWidth + this.getPositionForIndex(i, WIDTH);
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

customElements.define("time-chart", TimeChartElement);

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

customElements.define("frequency-chart", FrequencyChartElement);

