
abstract class LineChartElement extends HTMLElement {
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

        this.canvas = document.createElement("canvas");
        this.canvas.width = 1024;
        this.canvas.height = 256;
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
        this.draw();
    }

    getContext(): CanvasRenderingContext2D {
        return this.canvas.getContext("2d");
    }

    abstract getHeightForValue(value: number, height: number): number;
    abstract getPositionForIndex(index: number, width: number): number;

    draw() {
        if (this.autoRefresh.checked) {
            requestAnimationFrame(() => { this.draw() });
        }

        const WIDTH = this.canvas.width;
        const HEIGHT = this.canvas.height;

        if (!this.refreshData(this.dataArray)) {
            return;
        }

        this.context.fillStyle = "rgb(200, 200, 200)";
        this.context.fillRect(0, 0, WIDTH, HEIGHT);
        this.context.lineWidth = 1;
        this.context.strokeStyle = "rgb(0, 0, 0)";
        this.context.beginPath();

        for (let i = 0; i < this.dataArray.length; i++) {
            const x = this.getPositionForIndex(i, WIDTH);
            const y = this.getHeightForValue(this.dataArray[i], HEIGHT);

            if (i === 0) {
                this.context.moveTo(x, y);
            } else {
                this.context.lineTo(x, y);
            }
        }
        this.context.stroke();
    }
}

export class TimeChartElement extends LineChartElement {
    analyser: AnalyserNode;

    constructor() {
        super();
    }

    setAnalyserNode(analyser: AnalyserNode) {
        this.analyser = analyser;
        this.setDataSize(analyser.fftSize);
    }

    refreshData(data: Float32Array): boolean {
        if (!this.analyser) {
            return false;
        }
        this.analyser.getFloatTimeDomainData(data);
        return true;
    }

    getHeightForValue(value: number, height: number): number {
        const v = value * height / 2;
        const y = height / 2 + v;
        return y;
    }

    getPositionForIndex(index: number, width: number): number {
        const sliceWidth = (width * 1.0) / this.analyser.fftSize;
        return sliceWidth * index;
    }
}

customElements.define("time-chart", TimeChartElement);

export class FrequencyChartElement extends LineChartElement {
    analyser: AnalyserNode;
    minDb: number = -140;
    maxDb: number = 40;

    constructor() {
        super();
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
}

customElements.define("frequency-chart", FrequencyChartElement);

