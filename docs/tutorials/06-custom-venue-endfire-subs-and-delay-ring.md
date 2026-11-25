# Tutorial 06: Custom Multi-Zone Venues, End-Fire Subs & Delay Rings (`WebSpeakerSim`)

Beyond small standing clubs, real-world productions span multi-tier raked theaters with overhanging balconies and `50 m+` outdoor festival fields requiring end-fire subwoofer arrays and time-aligned delay towers. This tutorial covers building custom multi-zone venues from scratch and designing long-throw outdoor systems in **WebSpeakerSim** (`http://localhost:5174`).

---

## 1. Sizing Venue Grid Bounds & Building Multi-Zone Seating from Scratch

Every venue in **WebSpeakerSim** is built from two foundational ingredients: **Venue Grid Bounds** (the simulated 3D volume) and **Audience / Stage Zones** (trapezoidal flat, raked, or elevated listening planes).

1. Click **`Atmosphere, Colormap & Venue Bounds`** at the bottom of the right-hand **Scene Tree**:
   - Under **`Venue Grid Bounds & Section Slice (m)`**, enter your room or field dimensions: **`X Min`** (upstage wall, e.g. `-5 m`), **`X Max`** (rear wall, e.g. `28 m`), **`Y Min` / `Y Max`** (side walls, e.g. `-10` to `+10 m`), and **`Ceiling Z Max`** (`10 m`).
   - Double-click inside **Plan View** and **Side Section** (or click **`Fit`** in each viewport header) to frame the updated grid.

<!-- screenshot
app: wss
scene: t06-04-venue-bounds-and-slice
regions: [viewport-section, right-dock]
description: Side Section slice alongside the Atmosphere, Colormap & Venue Grid Bounds inspector showing ISO 9613-1 temperature/humidity and editable X/Y/Z bounds + Section Slice Y.
annotations:
  - badge: 1
    target: "[data-testid='env-temp-c']"
    label: "ISO 9613-1 Atmosphere"
    placement: left
  - badge: 2
    target: "[data-testid='env-bounds-xmax']"
    label: "Editable 3D Grid Bounds"
    placement: left
  - badge: 3
    target: "[data-testid='env-slice-y']"
    label: "Side Section Cut Plane Y"
    placement: top
-->
![Atmosphere, Ground Reflection & Editable Venue Grid Bounds Inspector](./images/t06-04-venue-bounds-and-slice-inspector.png)

2. **Creating Stage, Raked Orchestra & Overhanging Balcony Zones (`+ Zone`):**
   - Load **`Raked Auditorium & Balcony — Multi-Tier Point Sources`** in the **`Scene ▾`** dropdown (or click **`+ Zone`** under **Audience & Stage Zones** to add surfaces manually) and select **`Upper Balcony Tier`**:
     - **`Role`:** Set to **`Audience`** for seating areas (included in `Mean`, `±3dB`, and `SPL Histogram`) or **`Stage`** for the performance deck (`Stage Rej`).
     - **Splayed Trapezoid Widths:** Set **`Width Start (m)`** (`17 m`) and **`Width End (m)`** (`18 m`) around **`Y Center (m)`** (`0 m`) to model fan-shaped auditoriums.
     - **Sloped Rakes & Elevated Balconies:** Set **`Deck Z Start (m)`** and **`Deck Z End (m)`**—for example, `Raked Orchestra Seating` rises from `0.0 m` at `X = 2 m` to `2.6 m` at `X = 24 m`, while `Upper Balcony Tier` overhangs `X = 15–26 m` with deck height rising from **`4.8 m` to `7.0 m`**. Adding **`Ear Height (m)`** (`1.20 m` seated) places balcony listener ears at **`6.0–8.2 m`** (`cyan` dashed ear-line in Side Section).
     - **Overhang Priority:** Where an elevated balcony overhangs the rear orchestra in **Plan View**, WebSpeakerSim displays the highest active audience surface at `(X, Y)`, while **Side Section** slices cleanly through both tiers at **`Slice Y (m)`** (`3.5 m`).

<!-- screenshot
app: wss
scene: t06-01-custom-raked-balcony-zones
description: Multi-tier theater scene showing overhanging Upper Balcony Tier in Plan and Side Section alongside Trapezoid & Rake Geometry inspector controls.
annotations:
  - badge: 1
    target: "[data-testid='viewport-section']"
    subbox: [0.54, 0.16, 0.36, 0.42]
    label: "Overhanging Balcony Rake"
    placement: bottom
  - badge: 2
    target: "[data-testid='btn-add-surface']"
    label: "Add Audience / Stage Zone"
    placement: left
  - badge: 3
    target: "[data-testid='inspector-surface']"
    subbox: [0.04, 0.45, 0.92, 0.45]
    label: "Deck Z Start/End & Ear Height"
    placement: left
-->
![Raked Orchestra & Overhanging Balcony Zone Inspector in WebSpeakerSim](./images/t06-01-custom-raked-balcony-zones.png)

> **Electronic Delay Arc Subwoofers in Wide Theaters:** Notice **`Under-Stage Delay Arc Subs`** (`6×` 18" cabinets in **`Electronic Delay Arc`** mode, `85°` arc angle) under the theater stage. By applying progressive convex electronic delays to the outer pairs, a straight under-stage broadside line widens horizontal low-frequency coverage smoothly across splayed seating without narrowing into a tight center "power alley."

---

## 2. Outdoor Festival Design: End-Fire Subs & `26 m` Delay Towers

Switch **`Scene ▾`** in the top bar to **`Outdoor Field — 15" Mains + End-Fire Subs + Delay Ring`** (`55 m × 30 m` festival field, `26 °C`, `45% RH`).

<!-- screenshot
app: wss
scene: t06-02-outdoor-endfire-delay-ring
description: 55 m x 30 m Outdoor Festival Field preset showing 15-inch main hangs, 4-deep End-Fire subwoofer array, and 26 m delay tower ring achieving 81% +-3 dB coverage.
annotations:
  - badge: 1
    target: "[data-testid='coverage-metrics']"
    label: "81% ±3 dB Across 52 m Field"
    placement: bottom
  - badge: 2
    target: "[data-testid='viewport-plan']"
    subbox: [0.46, 0.14, 0.16, 0.72]
    label: "26 m Delay Tower Ring"
    placement: right
  - badge: 3
    target: "[data-testid='sa-mode-select']"
    label: "4-Deep Progressive End-Fire"
    placement: left
-->
![Outdoor Festival Field with 4-Deep End-Fire Subs and 26 m Delay Ring](./images/t06-02-outdoor-endfire-delay-ring.png)

### How the `4`-Deep End-Fire Subwoofer Array Works
Select **`Center 4-Deep End-Fire Subs`** under **Subwoofer Arrays** (`Array Mode: End-Fire`, `4` dual-18" enclosures spaced `1.25 m` front-to-back along `+X`, tuned to `68 Hz`):
- Unlike a `CSA` stack (which flips rear cabinets backward), **every cabinet in an End-Fire line faces forward (`+X`)** with normal polarity (`+ Norm`).
- **WebSpeakerSim** applies progressive electronic delay $\tau_k = k \cdot d / c$ from the rear box (`0.00 ms` at `X = -1.48 m`) forward to the front box (`10.80 ms` at `X = +2.28 m`) so each rear wave catches up and **sums coherently in phase toward the field (`+X`)**, while spreading arrivals backward onto the stage into multi-tap comb cancellation (`Stage Rej` stays positive even with `4` dual-18" boxes on the downstage lip).

---

## 3. Checking Throw & Delay Ring Timing with the Acoustic Ruler (`Shift + Drag`)

On a `52 m` field, inverse-square spreading (`-6 dB` per distance doubling) plus `26 °C` high-frequency air absorption (`ISO 9613-1`) causes main hangs alone to drop more than `14 dB` from front barrier to the rear field. Adding **`Delay Tower L / R`** at **`X = 26 m`** restores rear-field vocal intelligibility and brings broadband `±3 dB` evenness to **`81%`**.

1. **Quick Geometric Flight-Time Check (`Shift + Drag` Ruler):**
   - Switch layout to **`Plan`** (key **`2`**) or use **Split** view, hold **`Shift`**, and drag from **`Main Hang L`** (`X = 0.5 m, Y = 8.0 m`) out to **`Delay Tower L`** (`X = 26 m, Y = 11 m`) or **`Rear Field (42 m)`**:
   - The live yellow ruler overlay reports both **3D/2D distance (`m`)** and **acoustic flight time (`ms`)** at the current atmospheric speed of sound (`c = 346.9 m/s` at `26 °C`).

<!-- screenshot
app: wss
scene: t06-03-acoustic-ruler-delay-check
regions: [viewport-plan]
description: Plan View with Shift + Drag acoustic ruler measuring throw distance in meters and flight time in milliseconds at the venue atmospheric speed of sound.
annotations:
  - badge: 1
    target: "[data-testid='viewport-plan']"
    subbox: [0.33, 0.31, 0.24, 0.18]
    label: "Shift+Drag Distance (m) & Flight (ms)"
    tone: warn
    placement: bottom
-->
![Measuring Throw Distance & Acoustic Flight Time with Shift + Drag Ruler](./images/t06-03-acoustic-ruler-delay-check.png)

2. **Exact Phase Alignment & Arrival Inspection at the Hand-Off Mic:**
   - Select **`Rear Field (42 m)`** under **Virtual Mics**, switch the bottom chart drawer to **`Arrivals`** to inspect direct vs. dashed ground-bounce arrival stems, set **`Reference`** to **`Main 15" L/R`** (including its `9.2 ms` end-fire sub alignment delay) and **`Target`** to **`26 m Delay Towers`**, and click **`Apply Delay & Polarity`** (`~84.5 ms` total electronic delay—combining the `~75 ms` air flight delta from mains to the delay mast plus the mains' `9.2 ms` base delay so arrivals lock coherently in the overlap zone).

<!-- screenshot
app: wss
scene: t06-05-delay-ring-handoff-alignment
regions: [chart-drawer, right-dock]
description: Rear Field (42 m) Virtual Mic selected with the Arrivals impulse stem plot open and Auto Time-Alignment locking the 26 m Delay Towers to the Main 15-inch L/R arrival.
annotations:
  - badge: 1
    target: "[data-testid='chart-drawer']"
    subbox: [0.22, 0.2, 0.45, 0.58]
    label: "Coincident Main & Delay Arrivals"
    placement: right
  - badge: 2
    target: "[data-testid='auto-time-align-panel']"
    label: "Ref: Mains → Target: Delay Ring"
    placement: left
-->
![Rear Field Virtual Mic Arrivals Plot & Delay Ring Auto Time-Alignment](./images/t06-05-delay-ring-handoff-alignment.png)

---

*Return to the [FOH Tutorial Index](./README.md).*

