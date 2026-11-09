// コースデータと幾何計算。ブラウザとNode（検証スクリプト）の両方から読み込める。
(function (root) {
  'use strict';

  // 制御点 [x, z, 高さy]（メートル）。閉じたスプラインでつなぐ。xzScale は平面方向の拡大率。
  const COURSES = [
    {
      // 北向きのスタート直線 → 右回りで東へ → 丘のジャンプ → 西へ向かって
      // スタート直線の上を立体交差 → 左回りで南へ → 東へ → スタートへ戻る 8の字コース。
      name: 'MEADOW LOOP',
      xzScale: 1.25,
      control: [
        [0, 0, 20], [0, 250, 22], [40, 450, 46], [160, 570, 58], [310, 530, 52],
        [370, 400, 34], [372, 300, 46], [340, 205, 12], [200, 150, 16], [70, 150, 40],
        [-140, 160, 48], [-300, 110, 40], [-340, -60, 26], [-230, -205, 12],
        [-70, -230, 10], [0, -120, 17],
      ],
    },
    {
      // 夕焼けの峡谷。右回りの1周に S 字と大きな落差のジャンプ、谷底すれすれのくぼみ。
      name: 'CANYON RIDGE',
      xzScale: 1.5,
      control: [
        [0, 0, 25], [0, 200, 26], [40, 330, 38], [150, 380, 52], [250, 330, 50],
        [268, 250, 58], [262, 200, 58], [220, 120, 16], [250, 20, 30], [330, -60, 44], [310, -170, 46],
        [200, -220, 30], [80, -260, 14], [0, -180, 34], [0, -80, 30],
      ],
    },
    {
      // 夕暮れの海。西へ走ってから左へ 270 度回り込み、自分の走った道の上を越える。
      name: 'TWILIGHT BAY',
      xzScale: 1.4,
      control: [
        [400, 100, 18], [250, 100, 10], [100, 100, 18], [0, 50, 30], [-10, -60, 22],
        [60, -150, 40], [190, -140, 30], [260, -40, 48], [265, 100, 50], [270, 215, 58],
        [282, 258, 58], [340, 360, 24], [480, 380, 44], [580, 300, 26], [570, 180, 34], [500, 110, 22],
      ],
    },
  ];

  const HALF_W = 7;      // 路面の半幅
  const SEG = 2;         // サンプル間隔の目安（実際は全長を割り切る値）

  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  // セントリペタル Catmull-Rom（ループや尖りを防ぐ）
  function catmull(p0, p1, p2, p3, u) {
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1));
    const t2 = t1 + Math.sqrt(dist(p1, p2));
    const t3 = t2 + Math.sqrt(dist(p2, p3));
    const t = t1 + (t2 - t1) * u;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a1 = ((t1 - t) * p0[k] + (t - t0) * p1[k]) / (t1 - t0);
      const a2 = ((t2 - t) * p1[k] + (t - t1) * p2[k]) / (t2 - t1);
      const a3 = ((t3 - t) * p2[k] + (t - t2) * p3[k]) / (t3 - t2);
      const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
      const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
      out[k] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
    }
    return out;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function smoothCircular(arr, radius, passes) {
    const n = arr.length;
    let src = Float64Array.from(arr);
    for (let p = 0; p < passes; p++) {
      const dst = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += src[(i + k + n) % n];
        dst[i] = s / (radius * 2 + 1);
      }
      src = dst;
    }
    return src;
  }

  function build(courseIndex) {
    const course = COURSES[courseIndex || 0];
    const CONTROL = course.control, XZ_SCALE = course.xzScale;
    // 1) スプラインを細かく評価して弧長を求める
    const dense = [];
    const n = CONTROL.length;
    const STEPS = 400;
    for (let i = 0; i < n; i++) {
      const p0 = CONTROL[(i - 1 + n) % n], p1 = CONTROL[i];
      const p2 = CONTROL[(i + 1) % n], p3 = CONTROL[(i + 2) % n];
      for (let s = 0; s < STEPS; s++) {
        // 制御点は [x, z, y] なので [x, y, z] に並べ替える
        const q = catmull(p0, p1, p2, p3, s / STEPS);
        dense.push([q[0] * XZ_SCALE, q[2], q[1] * XZ_SCALE]);
      }
    }
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    const length = cum[cum.length - 1];
    const N = Math.round(length / SEG);
    const seg = length / N;

    // 2) 等間隔に再サンプリング
    const X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = i * seg;
      while (cum[j + 1] < target) j++;
      const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = dense[j], b = dense[(j + 1) % dense.length];
      X[i] = a[0] + (b[0] - a[0]) * f;
      Y[i] = a[1] + (b[1] - a[1]) * f;
      Z[i] = a[2] + (b[2] - a[2]) * f;
    }

    // 3) 向き・曲率・バンク角・路面の右方向ベクトルと法線
    const TH = new Float64Array(N), K = new Float64Array(N), GR = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      TH[i] = Math.atan2(X[b] - X[a], Z[b] - Z[a]);
      GR[i] = (Y[b] - Y[a]) / (2 * seg);
    }
    for (let i = 0; i < N; i++) {
      K[i] = wrapAngle(TH[(i + 1) % N] - TH[(i - 1 + N) % N]) / (2 * seg);
    }
    const Ks = smoothCircular(K, 3, 2);
    const bankRaw = Ks.map((k) => Math.max(-0.42, Math.min(0.42, -k * 26)));
    const B = smoothCircular(bankRaw, 14, 3);

    const RX = new Float64Array(N), RY = new Float64Array(N), RZ = new Float64Array(N);
    const NX = new Float64Array(N), NY = new Float64Array(N), NZ = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const hx = Math.cos(TH[i]), hz = -Math.sin(TH[i]); // 水平な右方向
      const cb = Math.cos(B[i]), sb = Math.sin(B[i]);
      RX[i] = hx * cb; RY[i] = sb; RZ[i] = hz * cb;
      NX[i] = -hx * sb; NY[i] = cb; NZ[i] = -hz * sb;
    }

    return { name: course.name, CONTROL, HALF_W, N, seg, length, X, Y, Z, TH, K: Ks, GR, B, RX, RY, RZ, NX, NY, NZ };
  }

  // 連続な距離 s の地点を補間して out に書き込む
  function sample(T, s, out) {
    const L = T.length;
    s = ((s % L) + L) % L;
    const fi = s / T.seg;
    let i = Math.floor(fi);
    const f = fi - i;
    i %= T.N;
    const j = (i + 1) % T.N;
    const l = (a) => a[i] + (a[j] - a[i]) * f;
    out.i = i;
    out.x = l(T.X); out.y = l(T.Y); out.z = l(T.Z);
    out.rx = l(T.RX); out.ry = l(T.RY); out.rz = l(T.RZ);
    out.nx = l(T.NX); out.ny = l(T.NY); out.nz = l(T.NZ);
    out.k = l(T.K); out.bank = l(T.B); out.grade = l(T.GR);
    out.th = T.TH[i] + wrapAngle(T.TH[j] - T.TH[i]) * f;
    return out;
  }

  root.SkywayTrack = { build, sample, wrapAngle, HALF_W, COURSES };
})(typeof window !== 'undefined' ? window : globalThis);
