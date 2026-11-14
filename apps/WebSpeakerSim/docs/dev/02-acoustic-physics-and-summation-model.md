# 02. Acoustic Physics & Complex Summation Model

## 1. 3D Coordinate & Orientation Conventions

All spatial calculations in `src/physics/` use a **right-handed 3D Cartesian coordinate system** in meters:
- **$+X$ (Depth / Throw Axis):** Points from the stage origin ($X = 0$) forward toward FOH / rear of the venue.
- **$+Y$ (Lateral Axis):** Points toward Stage Left (Audience Right when facing the stage); $Y = 0$ is the venue centerline, and $-Y$ is Stage Right (Audience Left).
- **$+Z$ (Vertical Axis):** Points upward from the reference ground/floor datum ($Z = 0$).

### 1.1 Loudspeaker Local Frame & Aiming Angles
In a loudspeaker's unrotated local frame:
- Local $+x_L$ is the **on-axis acoustic radiation vector** $(\theta = 0^\circ, \phi = 0^\circ)$.
- Local $+y_L$ points horizontally to the enclosure's left (looking out from the grille).
- Local $+z_L$ points toward the top of the enclosure.

Cabinet orientation in world space is parameterized by intrinsic Z–Y'–X'' Euler angles:
1. **Azimuth / Pan ($\phi_{\text{aim}}$, yaw around $+Z$):** $0^\circ$ aims straight down $+X$; positive angles rotate counter-clockwise in Plan View toward $+Y$ (Stage Left); negative angles rotate toward $-Y$ (Stage Right).
2. **Tilt / Pitch ($\theta_{\text{aim}}$, pitch around local lateral axis):** $0^\circ$ is horizontal; **negative** angles (e.g., $-10^\circ$) tilt the enclosure **downward** toward the audience floor, matching standard live-sound rigging conventions where downward tilt is negative; positive angles tilt upward toward balconies.
3. **Roll ($\psi_{\text{aim}}$, rotation around on-axis $+x_L$):** $0^\circ$ is upright portrait orientation; $90^\circ$ rotates the enclosure onto its side (horizontally swapping its H and V dispersion planes!).

With downward tilt defined as $\theta_{\text{aim}} < 0$, the local-to-world rotation matrix $\mathbf{R} = \mathbf{R}_z(\phi_{\text{aim}}) \, \mathbf{R}_y(-\theta_{\text{aim}}) \, \mathbf{R}_x(\psi_{\text{aim}})$ transforms unit vectors cleanly, and its transpose $\mathbf{R}^\top$ maps any world source-to-receptor displacement $\mathbf{d}_w = \mathbf{r} - \mathbf{s}$ into the enclosure's local frame $\mathbf{d}_L = (x_L, y_L, z_L)^\top = \mathbf{R}^\top \mathbf{d}_w$:
- **Distance:** $d = \|\mathbf{d}_w\|_2 = \sqrt{x_L^2 + y_L^2 + z_L^2}$ (clamped to $d_{\min} = 0.25\text{ m}$ to avoid near-field $1/d$ singularities).
- **Off-Axis Polar Angle ($\beta \in [0, \pi]$) & Meridian Roll Angle ($\gamma \in (-\pi, \pi]$)** (spherical balloon convention):
  $$\beta = \arccos\!\left(\frac{x_L}{d}\right), \qquad \gamma = \operatorname{atan2}(z_L, y_L)$$
- **Horizontal & Vertical Off-Axis Angles** (for separable H×V horn/polar lookup):
  $$\alpha_H = \operatorname{atan2}(y_L, x_L), \qquad \alpha_V = \operatorname{atan2}(z_L, x_L)$$

---

## 2. Atmospheric Speed of Sound & ISO 9613-1 Air Absorption (`atmosphere.ts`)

### 2.1 Speed of Sound
Given ambient air temperature $T_C$ ($^\circ\text{C}$), relative humidity $h_{\text{rel}} \in [0, 100]\%$, and barometric pressure $p_a$ ($\text{kPa}$, standard $p_r = 101.325\text{ kPa}$), absolute temperature is $T = T_C + 273.15\text{ K}$ ($T_0 = 293.15\text{ K}$, triple-point $T_{01} = 273.16\text{ K}$). Accounting for water vapor molar concentration $h$ (%):

$$\log_{10}(p_{\text{sat}} / p_r) = -6.8346 \left(\frac{T_{01}}{T}\right)^{1.261} + 4.6151$$

$$h = h_{\text{rel}} \frac{p_{\text{sat}}}{p_a}, \qquad c(T, h) \approx 343.2 \sqrt{\frac{T}{T_0}} \cdot \left(1 + 0.0016 \, h\right) \;\text{m/s}$$

### 2.2 ISO 9613-1 Attenuation Coefficient $\alpha(f)$
High-frequency air absorption is governed by oxygen ($f_{rO}$) and nitrogen ($f_{rN}$) molecular relaxation frequencies (in $\text{Hz}$):

$$f_{rO} = \frac{p_a}{p_r} \left(24 + 4.04 \times 10^4 \, h \, \frac{0.02 + h}{0.391 + h}\right)$$

$$f_{rN} = \frac{p_a}{p_r} \left(\frac{T}{T_0}\right)^{-1/2} \left(9 + 280 \, h \, \exp\!\left\{-4.170 \left[\left(\frac{T}{T_0}\right)^{-1/3} - 1\right]\right\}\right)$$

The attenuation coefficient $\alpha(f)$ in **$\text{dB/m}$** is:

$$\alpha(f) = 8.686 \, f^2 \left( \left[1.84 \times 10^{-11} \left(\frac{p_a}{p_r}\right)^{-1} \left(\frac{T}{T_0}\right)^{1/2}\right] + \left(\frac{T}{T_0}\right)^{-5/2} \left[ \frac{0.01275 \, e^{-2239.1 / T}}{f_{rO} + f^2 / f_{rO}} + \frac{0.1068 \, e^{-3352.0 / T}}{f_{rN} + f^2 / f_{rN}} \right] \right)$$

At $20^\circ\text{C}$ and $50\%\text{ RH}$, $\alpha(1\text{ kHz}) \approx 0.005\text{ dB/m}$ while $\alpha(10\text{ kHz}) \approx 0.16\text{ dB/m}$ ($4.8\text{ dB}$ loss at $30\text{ m}$ throw!).

---

## 3. Complex Pressure Summation & Planar Image-Source Reflections (`summation-solver.ts`)

### 3.1 Single-Frequency Complex Pressure
Each active acoustic radiator $i \in \{1, \dots, N\}$ is driven with reference 1-meter RMS acoustic pressure $P_{1\text{m}, i}(f) = p_0 \cdot 10^{L_{\text{drive}, i}(f) / 20}$ (relative to $p_0 = 20\;\mu\text{Pa}$, so we compute directly in normalized pressure units where $1.0 \equiv 0\text{ dB SPL}$ and $10^{L/20}$ scales linear pressure without precision loss).

With complex DSP transfer function $H_{\text{DSP}, i}(f)$ (incorporating gain $10^{G_i/20}$, polarity $\pm 1$, electronic delay $e^{-j 2\pi f \tau_i}$, crossover, and biquad EQ) and complex 3D balloon factor $D_i(\mathbf{d}_{L, i}, f)$, the free-field Green's propagation contribution from source position $\mathbf{s}_i$ to receptor $\mathbf{r}$ at wavenumber $k = 2\pi f / c$ is:

$$p_{\text{direct}, i}(\mathbf{r}, f) = \frac{A_{\text{ref}, i}(f) \cdot D_i(\mathbf{R}_i^\top(\mathbf{r} - \mathbf{s}_i), f) \cdot H_{\text{DSP}, i}(f)}{d_i} \cdot 10^{-\alpha(f) d_i / 20} \cdot e^{-j k d_i}$$

### 3.2 Planar Image-Source Reflection (Ground Bounce & Future Boundaries)
Given any reflective plane $\Pi = (\hat{\mathbf{n}}, d_\Pi)$ satisfying $\hat{\mathbf{n}} \cdot \mathbf{x} = d_\Pi$ (for the ground floor, $\hat{\mathbf{n}} = (0, 0, 1)^\top, d_\Pi = 0$) with real/complex reflection factor $R_\Pi(f) \in [0, 1]$ (e.g., $R_g = 0.95$ for hard concrete/asphalt, $0.70$ for turf/soil, $0.0$ for free-field):
1. **Mirrored Position:** $\mathbf{s}'_i = \mathbf{s}_i - 2 \left(\hat{\mathbf{n}} \cdot \mathbf{s}_i - d_\Pi\right) \hat{\mathbf{n}}$.
2. **Mirrored Frame:** $\mathbf{R}'_i = \mathbf{M}_\Pi \mathbf{R}_i$, where $\mathbf{M}_\Pi = \mathbf{I} - 2 \hat{\mathbf{n}} \hat{\mathbf{n}}^\top$ is the Householder reflection matrix, so off-axis radiation toward the floor before bouncing to $\mathbf{r}$ is evaluated at the exact downward exit angle on the speaker's directivity balloon!
3. **Total Complex Pressure at $(\mathbf{r}, f)$:**
   $$p_{\text{total}}(\mathbf{r}, f) = \sum_{i=1}^{N} \left[ p_{\text{direct}, i}(\mathbf{r}, f) + \sum_{\Pi \in \mathcal{B}} R_\Pi(f) \, p_{\text{image}, i, \Pi}(\mathbf{r}, f) \right]$$

For a ground-stacked subwoofer at $z_s = 0.3\text{ m}$ at $50\text{ Hz}$ ($\lambda \approx 6.86\text{ m}$), path-length difference $\Delta d \ll \lambda/4$, so direct and ground-reflected waves sum coherently in phase, naturally producing the physical **$+5.8\text{ to }+6.0\text{ dB}$ half-space acoustic loading**!

### 3.3 Broadband & Band-Integrated SPL
Across a multi-band evaluation set $\{f_1, \dots, f_M\}$ with spectral program weighting $W_{\text{prog}}(f_m)$ (e.g., pink noise = equal energy per fractional-octave band, or live-music contour) and IEC 61672 weighting $W_{\text{IEC}}(f_m) \in \{\text{Z}, \text{A}, \text{C}\}$:

$$L_p(\mathbf{r}) = 10 \log_{10} \left( \sum_{m=1}^{M} \left| p_{\text{total}}(\mathbf{r}, f_m) \right|^2 \cdot 10^{\left(W_{\text{prog}}(f_m) + W_{\text{IEC}}(f_m)\right) / 10} \right) \;\text{dB SPL}$$

---

## 4. Subwoofer Array & Alignment Mathematics (`sub-array-designer.ts`)

### 4.1 End-Fire Subwoofer Array
For $N$ identical omnidirectional subwoofers placed colinearly along $+X$ at spacing $\Delta x = c / (4 f_{\text{tune}})$ (typically $\lambda / 4$ at tuning frequency $f_{\text{tune}}$, e.g., $1.07\text{ m}$ for $80\text{ Hz}$):
- Cabinet $n \in \{0, \dots, N-1\}$ is positioned at $x_n = x_0 + n \, \Delta x$ and delayed by $\tau_n = n \, \Delta x / c$.
- **Forward ($+X$):** Acoustic travel delay $(N-1-n)\Delta x / c$ adds to electronic delay $n \Delta x / c = (N-1)\Delta x / c$ identically for all boxes $\implies$ coherent $+20 \log_{10}(N)\;\text{dB}$ summation across all frequencies!
- **Rear ($-X$, toward stage):** Relative phase spacing between adjacent boxes is $2 \cdot (\Delta x / \lambda) \cdot 360^\circ$; at $f_{\text{tune}}$ ($\Delta x = \lambda / 4$ for $N=2$, or $\Delta x = c / (N f_{\text{tune}})$ for general $N$-element rear nulling), rear waves cancel destructively.

### 4.2 Cardioid Subwoofer Array (CSA / Inverted Stack or Side-by-Side)
For a 2-element (1 rear inverted, 1 front) or 3-element (2 front, 1 rear inverted at $-6\text{ dB}$ or gain-matched) gradient array with physical acoustic center offset $d_{\text{offset}}$ between front and rear acoustic centers:
- Rear element has **inverted polarity ($180^\circ$)** and electronic delay $\tau_{\text{rear}} = d_{\text{offset}} / c$.
- **Rear ($-X$):** Front wave travels $d_{\text{offset}}$ to reach rear cabinet, arriving simultaneously with the inverted, delayed rear wave $\implies$ broadband rear cancellation centered around $\lambda / 4 = d_{\text{offset}}$.
- **Forward ($+X$):** Rear wave is delayed by $\tau_{\text{rear}}$ electronically plus $d_{\text{offset}} / c$ acoustically ($2 d_{\text{offset}} / c = T / 2$ at $f = c / (4 d_{\text{offset}})$), combining with its $180^\circ$ polarity flip to arrive **in phase** forward at the tuning frequency!

### 4.3 Electronic Delay Arc (Broadside Horizontal Steering)
Given $N$ subwoofers arrayed laterally along $Y \in [-W/2, +W/2]$ at $X = x_0$ and a desired horizontal coverage splay angle $\Phi_{\text{arc}} \in (0^\circ, 140^\circ]$:
- A virtual point source is placed behind the line at radius $R_{\text{arc}} = \frac{W / 2}{\sin(\Phi_{\text{arc}} / 2)}$: $(x_{\text{virt}}, y_{\text{virt}}) = (x_0 - R_{\text{arc}} \cos(\Phi_{\text{arc}}/2), 0)$ (or $(x_0 - R_{\text{arc}}, 0)$ for circular arc).
- Each cabinet at $y_n$ receives delay:
  $$\tau_n = \frac{\sqrt{R_{\text{arc}}^2 + y_n^2} - R_{\text{arc}}}{c}$$
  curving the wavefront symmetrically without physically moving heavy enclosures.

