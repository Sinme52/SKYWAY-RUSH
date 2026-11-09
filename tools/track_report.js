// コースの幾何を検査する: node tools/track_report.js
require('../track.js');
const { COURSES, build } = globalThis.SkywayTrack;
COURSES.forEach((_, ci) => {
  const T = build(ci);
  let kmax = 0, gmax = 0, ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < T.N; i++) {
    kmax = Math.max(kmax, Math.abs(T.K[i])); gmax = Math.max(gmax, Math.abs(T.GR[i]));
    ymin = Math.min(ymin, T.Y[i]); ymax = Math.max(ymax, T.Y[i]);
  }
  const crests = [];
  for (let i = 0; i < T.N; i++) {
    const a = (i - 3 + T.N) % T.N, b = (i + 3) % T.N;
    const c = (T.GR[b] - T.GR[a]) / (6 * T.seg);
    if (c < -1 / 260 && (!crests.length || i * T.seg - crests[crests.length - 1][0] > 30)) crests.push([Math.round(i * T.seg), Math.round(-1 / c)]);
  }
  // 平面上で近づく別区間（立体交差・すれ違い）の最小の高低差
  let minClear = 1e9, minDist = 1e9, crossings = 0;
  for (let i = 0; i < T.N; i += 2) for (let j = i + 2; j < T.N; j += 2) {
    const ds = Math.min(j - i, T.N - (j - i)) * T.seg;
    if (ds < 80) continue;
    const d = Math.hypot(T.X[i] - T.X[j], T.Z[i] - T.Z[j]);
    if (d < 2 * T.HALF_W + 4) { crossings++; minClear = Math.min(minClear, Math.abs(T.Y[i] - T.Y[j])); }
    else minDist = Math.min(minDist, d);
  }
  console.log(`${T.name}: length ${T.length.toFixed(0)}m, min radius ${(1 / kmax).toFixed(0)}m, max grade ${gmax.toFixed(2)}, height ${ymin.toFixed(0)}..${ymax.toFixed(0)}m`);
  console.log(`  crests(s,radius) ${JSON.stringify(crests)}`);
  console.log(`  overlapping samples ${crossings}, min vertical clearance ${crossings ? minClear.toFixed(1) : '-'}m, nearest non-overlapping ${minDist.toFixed(1)}m`);
  // スタート付近の直線性
  console.log(`  curvature at start ${(T.K[0] * 1000).toFixed(2)}e-3`);
});
