// SKYWAY RUSH — 画像の「拡大縮小」と「回転」だけで描く疑似3Dレース。
// 路面・橋桁・鉄塔・木・車・空・地面はすべて画像(drawImage)を setTransform で
// 拡大縮小・回転して描いている。ポリゴンや塗りつぶしの図形は使わない
// （文字のHUDと、起動時に作るグラデーション画像だけは canvas の機能で作っている）。
(function () {
  'use strict';

  const TrackLib = window.SkywayTrack;
  let T = TrackLib.build(0);
  let courseIndex = 0;
  const HALF_W = TrackLib.HALF_W;

  // ---------------------------------------------------------------- 定数
  const W = 960, H = 540;
  const FOCAL = 720;            // 焦点距離（px）
  const NEAR = 1.2;
  const VIEW_DIST = 700;        // 描画距離（m）
  const FADE_START = 480;
  const LAT_RANGE = HALF_W - 1.5;
  const DECK_TH = 1.8;          // 路面の厚み
  const ROAD_TEX_LEN = 24;      // 道路テクスチャ1枚が表す長さ（m）
  const DECK_TEX_LEN = 24;
  const GROUND_TILE = 140;      // 地面テクスチャ1枚の大きさ（m）
  const GRAV = 22;
  const VMAX = 84;              // 約300km/h
  const LAPS = 3;
  const CAR_W = 2.9;            // 車の見た目の幅（m）
  const DT = 1 / 120;
  const FALL_LATVEL = 4;        // 外向きにこれ以上の速さで路肩を越えるとコースから落ちる（m/s）
  const CRASH_TIME = 1.0;       // 地面に落ちて「COURSE OUT」になってから復帰するまでの秒数
  const FALL_MAX_TIME = 6;      // 念のため：これ以上落ち続けたら復帰させる
  const BLINK_TIME = 2.2;       // 復帰後に点滅している（ぶつからない）秒数
  const AI_MISTAKE_CHANCE = 0.1;  // AIがきついカーブの手前で減速しそこなう確率（カーブ1つ・1台あたり）
  const AI_MISTAKE_TIME = 3;      // ミスが続く秒数
  const CENT = 0.32;            // 遠心力でコース外側へ流される強さ
  const AI_CORNER = 52;         // AIのコーナー速度の目安（大きいほど速く曲がる）

  const params = new URLSearchParams(location.search);
  const AUTOPILOT = params.has('autopilot');
  const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  // ---------------------------------------------------------------- 画像
  const FILES = {
    carRear: 'assets/car_rear.png', carRearRoll: 'assets/car_rear_roll.png', carRearSpin: 'assets/car_rear_spin.png',
    carTurn: 'assets/car_turn.png', carTurnRoll: 'assets/car_turn_roll.png', carTurnSpin: 'assets/car_turn_spin.png',
    road: 'assets/road.jpg', deck: 'assets/deck.jpg', pillar: 'assets/pillar.png',
    gate: 'assets/gate.png', logo: 'assets/logo.png',
    sky: 'assets/sky.jpg', ground: 'assets/ground.jpg',
    sky_canyon: 'assets/sky_canyon.jpg', ground_canyon: 'assets/ground_canyon.jpg',
    sky_bay: 'assets/sky_bay.jpg', ground_bay: 'assets/ground_bay.jpg',
    palm: 'assets/palm.png', tree: 'assets/tree.png', rock: 'assets/rock.png', windmill: 'assets/windmill.png',
    cactus: 'assets/cactus.png', arch: 'assets/arch.png', butte: 'assets/butte.png', deadtree: 'assets/deadtree.png',
    lighthouse: 'assets/lighthouse.png', sailboat: 'assets/sailboat.png', islet: 'assets/islet.png', buoy: 'assets/buoy.png',
  };
  const IMG = {};
  let ART = null;             // いま選んでいるコースの空・地面・景色

  // コースごとの空・地面・地平線のもやの色・地上の景色（h は高さ m、w は出現率）
  const COURSE_ART = [
    { sky: 'sky', ground: 'ground', haze: '200,225,250', kinds: [
      { img: 'palm', h: 15, w: 0.45 }, { img: 'tree', h: 12, w: 0.35 },
      { img: 'rock', h: 28, w: 0.1 }, { img: 'windmill', h: 17, w: 0.1 }] },
    { sky: 'sky_canyon', ground: 'ground_canyon', haze: '255,170,110', kinds: [
      { img: 'cactus', h: 10, w: 0.4 }, { img: 'deadtree', h: 11, w: 0.25 },
      { img: 'arch', h: 26, w: 0.15 }, { img: 'butte', h: 55, w: 0.2 }] },
    { sky: 'sky_bay', ground: 'ground_bay', haze: '240,160,200', kinds: [
      { img: 'buoy', h: 7, w: 0.35 }, { img: 'sailboat', h: 15, w: 0.3 },
      { img: 'islet', h: 14, w: 0.25 }, { img: 'lighthouse', h: 30, w: 0.1 }] },
  ];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('failed to load ' + src));
      im.src = src;
    });
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // 車のオレンジ部分だけ色相を回して色違いを作る（テールランプの赤やタイヤは残す）
  function recolor(img, hueShift) {
    const c = makeCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    if (!hueShift) return c;
    const data = g.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
      if (mx === 0 || d / mx < 0.45) continue;
      let h;
      if (mx === r) h = ((gg - b) / d) % 6;
      else if (mx === gg) h = (b - r) / d + 2;
      else h = (r - gg) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
      if (h < 12 || h > 52) continue;
      h = (h + hueShift) % 360;
      const s = d / mx, v = mx;
      const k = (n) => (n + h / 60) % 6;
      const f = (n) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
      p[i] = f(5) * 255;
      p[i + 1] = f(3) * 255;
      p[i + 2] = f(1) * 255;
    }
    g.putImageData(data, 0, 0);
    return c;
  }

  // 起動時に作る補助画像（影・火花・もや・タイル済みの地面）
  function makeAuxImages() {
    const shadow = makeCanvas(128, 64);
    let g = shadow.getContext('2d');
    let grad = g.createRadialGradient(64, 32, 4, 64, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.setTransform(2, 0, 0, 1, 0, 0);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    IMG.shadow = shadow;

    const spark = makeCanvas(32, 32);
    g = spark.getContext('2d');
    grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.35, 'rgba(255,200,60,0.9)');
    grad.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    IMG.spark = spark;

    // コースごとの地平線のもやと、3x3 に並べた地面（1回の drawImage で横方向に繰り返せる）
    IMG.courseArt = COURSE_ART.map((art) => {
      const haze = makeCanvas(4, 128);
      let hg = haze.getContext('2d');
      const hgrad = hg.createLinearGradient(0, 0, 0, 128);
      hgrad.addColorStop(0, `rgba(${art.haze},0.95)`);
      hgrad.addColorStop(1, `rgba(${art.haze},0)`);
      hg.fillStyle = hgrad;
      hg.fillRect(0, 0, 4, 128);
      const ground = IMG[art.ground];
      const gt = makeCanvas(ground.width * 3, ground.height * 3);
      hg = gt.getContext('2d');
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) hg.drawImage(ground, x * ground.width, y * ground.height);
      return { sky: IMG[art.sky], ground, groundTiled: gt, haze, kinds: art.kinds };
    });

    // 車は「通常・溝が進んだ絵・高速回転」の 3 コマ × 真後ろ／斜め後ろ
    const HUES = [0, 190, 95, 300, 150, 235, 330, 45];
    IMG.cars = HUES.map((hue) => ({
      rear: [IMG.carRear, IMG.carRearRoll, IMG.carRearSpin].map((im) => recolor(im, hue)),
      turn: [IMG.carTurn, IMG.carTurnRoll, IMG.carTurnSpin].map((im) => recolor(im, hue)),
    }));
  }

  // ---------------------------------------------------------------- 入力
  const keys = {};
  const touch = { left: false, right: false, accel: false, brake: false };
  let pressedStart = false;

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Enter' || e.code === 'Space') pressedStart = true;
    if (!e.repeat && game.state === 'title') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') changeCourse(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') changeCourse(1);
    }
    if (e.code === 'Escape' && game.state === 'finish') goTitle();
    if (e.code === 'KeyM') toggleMute();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    audioUnlock();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  canvas.addEventListener('pointerdown', () => { pressedStart = true; audioUnlock(); });

  document.querySelectorAll('[data-touch]').forEach((el) => {
    const name = el.dataset.touch;
    const on = (e) => {
      e.preventDefault();
      touch[name] = true;
      el.classList.add('on');
      audioUnlock();
      // タイトルでは ◀ ▶ でコース選択、A でスタート。ゴール後は A でもう一度、B でコース選択へ
      if (game.state === 'title' && (name === 'left' || name === 'right')) changeCourse(name === 'left' ? -1 : 1);
      else if (game.state === 'finish' && name === 'brake') goTitle();
      else if (name === 'accel') pressedStart = true;
    };
    const off = (e) => { e.preventDefault(); touch[name] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  });

  function readInput() {
    const left = keys.ArrowLeft || keys.KeyA || touch.left;
    const right = keys.ArrowRight || keys.KeyD || touch.right;
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      accel: !!(keys.ArrowUp || keys.KeyZ || keys.KeyW || touch.accel),
      brake: !!(keys.ArrowDown || keys.KeyX || keys.KeyS || touch.brake),
    };
  }

  // ---------------------------------------------------------------- 音（WebAudio で合成）
  let audio = null, muted = false;
  function audioUnlock() {
    if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(master);
    const eng = ac.createGain();
    eng.gain.value = 0;
    eng.connect(lp);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.connect(eng);
    const g2 = ac.createGain();
    g2.gain.value = 0.4;
    o2.connect(g2).connect(eng);
    o1.start();
    o2.start();
    const noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const scrape = ac.createGain();
    scrape.gain.value = 0;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    noise.connect(bp).connect(scrape).connect(master);
    noise.start();
    audio = { ctx: ac, master, eng, o1, o2, scrape };
    audio.master.gain.value = muted ? 0 : 0.5;
  }
  function toggleMute() {
    muted = !muted;
    if (audio) audio.master.gain.value = muted ? 0 : 0.5;
  }
  function beep(freq, len) {
    if (!audio) return;
    const ac = audio.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.18, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + len);
    o.connect(g).connect(audio.master);
    o.start();
    o.stop(ac.currentTime + len);
  }
  function fallSound() {
    if (!audio) return;
    const ac = audio.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(120, ac.currentTime + 1.2);
    g.gain.setValueAtTime(0.16, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.3);
    o.connect(g).connect(audio.master);
    o.start();
    o.stop(ac.currentTime + 1.3);
  }

  function crashSound() {
    if (!audio) return;
    const ac = audio.ctx, len = 0.5;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf;
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(audio.master);
    src.start();
    beep(70, 0.4);
  }

  function updateAudio(player, active) {
    if (!audio) return;
    const t = audio.ctx.currentTime;
    const v = player.v;
    // 疑似ギア：速度帯ごとに回転数が上がって落ちる
    const gear = Math.min(5, Math.floor(v / 18));
    const rpm = (v - gear * 18) / 18;
    const f = 55 + gear * 9 + rpm * 70;
    audio.o1.frequency.setTargetAtTime(f, t, 0.03);
    audio.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    audio.eng.gain.setTargetAtTime(active ? 0.16 : 0, t, 0.1);
    audio.scrape.gain.setTargetAtTime(active && player.scrape > 0 ? 0.12 : 0, t, 0.03);
  }

  // ---------------------------------------------------------------- 車
  const tmpA = {}, tmpB = {};

  function roadPoint(s, lat, out) {
    TrackLib.sample(T, s, tmpA);
    const m = lat * LAT_RANGE;
    out.x = tmpA.x + tmpA.rx * m;
    out.y = tmpA.y + tmpA.ry * m;
    out.z = tmpA.z + tmpA.rz * m;
    return out;
  }

  function makeCar(index, isPlayer, row, col) {
    return {
      index, isPlayer,
      s: -10 - row * 11 - col * 3,
      lat: col === 0 ? -0.45 : 0.45,
      v: 0, y: 0, vy: 0, air: false, latVel: 0,
      skin: IMG.cars[index],
      vmax: isPlayer ? VMAX : 74 + (index % 4) * 2.2 + Math.random() * 1.5,
      laneBias: (Math.random() - 0.5) * 0.5,
      targetLat: 0, scrape: 0, bump: 0, finished: false, finishTime: 0, place: 0,
      lapStart: 0, lastLap: 0, bestLap: 0, lap: 0, steerVis: 0,
      wheel: 0, fall: null, blink: 0, mistake: 0, cornerArmed: true, stun: 0,
    };
  }

  function roadY(c) {
    return roadPoint(c.s, c.lat, tmpB).y;
  }

  // 縦方向：道路が重力より速く下がれば空中に飛び出す
  function updateVertical(c, dt) {
    roadPoint(c.s, c.lat, tmpB);
    const gy = tmpB.y;
    if (!c.air) {
      const ballistic = c.y + c.vy * dt - 0.5 * GRAV * dt * dt;
      if (gy < ballistic && c.v > 30) {
        c.air = true;
        c.vy -= GRAV * dt;
        c.y += c.vy * dt;
      } else {
        c.vy = (gy - c.y) / dt;
        c.y = gy;
      }
    } else {
      c.vy -= GRAV * dt;
      c.y += c.vy * dt;
      if (c.y <= gy) {
        const slope = tmpA.grade * c.v;
        const impact = slope - c.vy;
        c.y = gy;
        c.vy = slope;
        c.air = false;
        if (impact > 6) {
          c.bump = Math.min(1, impact / 18);
          c.v *= 0.97;
          if (c.isPlayer) game.shake = Math.max(game.shake, c.bump * 6);
        }
      }
    }
  }

  function updatePlayer(c, input, dt) {
    TrackLib.sample(T, c.s, tmpA);
    const k = tmpA.k;
    if (input.accel) c.v += 26 * (1 - (c.v / VMAX) * (c.v / VMAX)) * dt;
    else c.v -= (2 + c.v * 0.012) * dt;
    if (input.brake) c.v -= 38 * dt;
    // 上り坂で減速、下り坂で加速
    if (!c.air) c.v -= tmpA.grade * 7 * dt;
    c.v = Math.max(0, Math.min(c.v, VMAX * 1.04));

    c.steerVis += (input.steer - c.steerVis) * Math.min(1, dt * 10);
    const flying = c.air && c.y - roadY(c) > 0.25;
    const grip = flying ? 0.25 : 1;
    const steerRate = (5 + c.v * 0.17) * grip;
    const centrifugal = flying ? 0 : k * c.v * c.v * CENT;
    const target = c.v > 1 ? input.steer * steerRate - centrifugal : 0;
    c.latVel += (target - c.latVel) * Math.min(1, dt * 8);
    moveLateral(c, dt);
  }

  function moveLateral(c, dt) {
    c.lat += (c.latVel * dt) / LAT_RANGE;
    c.scrape = Math.max(0, c.scrape - dt);
    // プレイヤーが勢いよく路肩を越えたら、コースから落ちる
    const canFall = c.isPlayer ? game.state === 'race' : game.state !== 'countdown';
    if (canFall && Math.abs(c.lat) > 1 && !c.blink && Math.sign(c.lat) * c.latVel > FALL_LATVEL && c.v > 20) {
      startFall(c);
      return;
    }
    if (Math.abs(c.lat) > 1) {
      c.lat = Math.sign(c.lat);
      c.latVel *= -0.25;
      if (c.v > 12) {
        c.v -= c.v * 1.3 * dt;
        c.scrape = 0.12;
        if (Math.random() < 0.6) spawnSpark(c);
        if (c.isPlayer) game.shake = Math.max(game.shake, 2);
      }
    }
  }

  function startFall(c) {
    TrackLib.sample(T, c.s, tmpA);
    const side = Math.sign(c.lat);
    const m = side * (LAT_RANGE + 0.8);
    const fwd = c.v * 0.4, out = Math.max(7, Math.abs(c.latVel));
    const sn = Math.sin(tmpA.th), cs = Math.cos(tmpA.th);
    c.fall = {
      t: 0, x: tmpA.x + tmpA.rx * m, y: c.y + 0.3, z: tmpA.z + tmpA.rz * m,
      vx: sn * fwd + cs * side * out, vy: 6, vz: cs * fwd - sn * side * out,
      spin: 0, spinRate: side * (7 + c.v * 0.08), th: tmpA.th, side,
    };
    c.air = true;
    c.scrape = 0;
    c.mistake = 0;
    if (c.isPlayer) {
      game.shake = Math.max(game.shake, 4);
      fallSound();
    }
  }

  // 落下中の車が、前のフレームから今のフレームの間に通り抜けた面の高さ（無ければ null）。
  // 地面（高さ 0）のほか、立体交差の下を通る別の路面にも当たる。
  function surfaceCrossed(c, x, z, yPrev, yNow) {
    let hit = yNow <= 0.4 ? 0.4 : null;
    const L = T.length;
    for (let i = 0; i < T.N; i++) {
      const dx = x - T.X[i], dz = z - T.Z[i];
      if (Math.abs(dx) > HALF_W + 2 || Math.abs(dz) > HALF_W + 2) continue;
      // 落ちはじめた所の路面は除く（そこから外へ飛び出したので）
      const ds = Math.abs((((i * T.seg - c.s) % L) + L * 1.5) % L - L * 0.5);
      if (ds < 40) continue;
      const sn = Math.sin(T.TH[i]), cs = Math.cos(T.TH[i]);
      if (Math.abs(dx * sn + dz * cs) > T.seg) continue;
      const latm = dx * cs - dz * sn;
      if (Math.abs(latm) > HALF_W) continue;
      const top = T.Y[i] + Math.tan(T.B[i]) * latm;
      if (yPrev >= top && yNow < top && (hit === null || top > hit)) hit = top;
    }
    return hit;
  }

  function updateFall(c, dt) {
    const f = c.fall;
    f.t += dt;
    const yPrev = f.y;
    f.vy -= GRAV * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    if (!f.landed) {
      f.vx *= 1 - 1.1 * dt;
      f.vz *= 1 - 1.1 * dt;
      f.spin += f.spinRate * dt;
      const hit = surfaceCrossed(c, f.x, f.z, yPrev, f.y);
      if (hit !== null) {
        // 地面（または下の路面）に落ちた時点でコースアウト
        f.landed = true;
        f.landT = 0;
        f.groundY = hit;
        f.y = hit;
        f.vy = Math.abs(f.vy) * 0.25;
        f.spinRate *= 0.3;
        spawnBurst(f.x, f.y + 0.5, f.z, 16);
        if (c.isPlayer) {
          game.shake = Math.max(game.shake, 7);
          crashSound();
        }
      }
    } else {
      // 地面で弾んでから止まる
      f.landT += dt;
      f.vx *= 1 - 4 * dt;
      f.vz *= 1 - 4 * dt;
      f.spinRate *= 1 - 3 * dt;
      f.spin += f.spinRate * dt;
      if (f.y < f.groundY) { f.y = f.groundY; f.vy = 0; }
    }
    c.v = Math.max(0, c.v - 40 * dt);
    c.y = f.y;
    if ((f.landed && f.landT > CRASH_TIME) || f.t > FALL_MAX_TIME) {
      // 落ちた地点のコース中央へ戻し、しばらく点滅させる
      c.fall = null;
      c.lat = 0;
      c.latVel = 0;
      c.v = 12;
      c.air = false;
      c.y = roadY(c);
      c.vy = 0;
      c.blink = BLINK_TIME;
      if (c.isPlayer) {
        beep(520, 0.12);
        setTimeout(() => beep(780, 0.15), 120);
      }
    }
  }

  // AIと自動操縦（?autopilot）で共有する運転ロジック
  function aiControls(c, cars) {
    let kAhead = 0;
    for (let d = 10; d <= 90; d += 20) {
      TrackLib.sample(T, c.s + d, tmpA);
      kAhead = Math.max(kAhead, Math.abs(tmpA.k));
    }
    TrackLib.sample(T, c.s + 25, tmpA);
    const corner = Math.sqrt(AI_CORNER / Math.max(1e-4, kAhead));
    let vt = Math.min(c.vmax, corner);
    let target = Math.max(-0.75, Math.min(0.75, tmpA.k * 45)) + c.laneBias;
    for (const o of cars) {
      if (o === c) continue;
      const ds = o.s - c.s;
      if (ds > 0 && ds < 22 && Math.abs(o.lat - target) < 0.4) target += o.lat > c.lat ? -0.55 : 0.55;
    }
    target = Math.max(-0.9, Math.min(0.9, target));
    return { vt, target };
  }

  function updateAI(c, cars, player, dt) {
    const { vt: vt0, target } = aiControls(c, cars);
    let vt = vt0;
    const gap = c.s - player.s;
    if (!c.finished) {
      if (gap > 160) vt *= 0.92;
      else if (gap < -160) vt *= 1.06;
    }
    // きついカーブの手前で、ときどき減速しそこなう（ハンドルも少し遅れる）
    c.mistake = Math.max(0, c.mistake - dt);
    TrackLib.sample(T, c.s + 70, tmpA);
    const kAhead = Math.abs(tmpA.k);
    if (kAhead < 1 / 300) c.cornerArmed = true;
    else if (kAhead > 1 / 110 && c.cornerArmed) {
      c.cornerArmed = false;
      if (game.state === 'race' && !c.blink && Math.random() < AI_MISTAKE_CHANCE) c.mistake = AI_MISTAKE_TIME;
    }
    if (c.mistake) vt = c.vmax;
    TrackLib.sample(T, c.s, tmpA);
    const k = tmpA.k, grade = tmpA.grade;
    if (c.v < vt) c.v += 22 * (1 - (c.v / (VMAX * 1.05)) ** 2) * dt;
    else c.v -= 16 * dt;
    if (!c.air) c.v -= grade * 7 * dt;
    c.v = Math.max(0, c.v);
    // プレイヤーと同じく遠心力で外側へ流される。曲がりきれなければコースから落ちる
    const flying = c.air && c.y - roadY(c) > 0.25;
    const steerRate = (5 + c.v * 0.17) * (flying ? 0.25 : 1);
    const centrifugal = flying ? 0 : k * c.v * c.v * CENT;
    const wantVel = Math.max(-6, Math.min(6, (target - c.lat) * 7));
    const steer = Math.max(-1, Math.min(1, (wantVel + centrifugal) / Math.max(1, steerRate))) * (c.mistake ? 0.7 : 1);
    c.stun = Math.max(0, c.stun - dt);
    // 立て直せないあいだは横滑りの勢いがそのまま残る
    const tgt = c.stun ? c.latVel * (1 - dt * 1.5) - centrifugal * dt : c.v > 1 ? steer * steerRate - centrifugal : 0;
    c.latVel += (tgt - c.latVel) * Math.min(1, dt * 6);
    c.steerVis = steer;
    moveLateral(c, dt);
  }

  function autopilotInput(c, cars) {
    const { vt, target } = aiControls(c, cars);
    TrackLib.sample(T, c.s, tmpA);
    const centrifugal = tmpA.k * c.v * c.v * CENT;
    const steerRate = 5 + c.v * 0.17;
    const want = (target - c.lat) * 6 + centrifugal;
    return {
      steer: Math.max(-1, Math.min(1, want / steerRate)),
      accel: c.v < vt * 1.02,
      brake: c.v > vt * 1.12,
    };
  }

  function collide(cars) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.fall || b.fall || a.blink > 0 || b.blink > 0) continue;
        const ds = b.s - a.s;
        if (Math.abs(ds) > 4.2) continue;
        const dl = (b.lat - a.lat) * LAT_RANGE;
        if (Math.abs(dl) > 2.2 || Math.abs(a.y - b.y) > 2) continue;
        const back = ds > 0 ? a : b, front = ds > 0 ? b : a;
        if (back.v > front.v) {
          const avg = (back.v + front.v) / 2;
          back.v = avg - 2;
          front.v = avg + 1;
        }
        const push = (2.2 - Math.abs(dl)) / LAT_RANGE / 2 + 0.01;
        const dir = dl >= 0 ? 1 : -1;
        a.lat -= push * dir;
        b.lat += push * dir;
        // 横からぶつけたときは、横方向の勢いの差に応じて強く押し出す（路肩際なら落ちる）
        const imp = 2 + Math.abs(a.latVel - b.latVel) * 0.8;
        a.latVel -= dir * imp;
        b.latVel += dir * imp;
        // 強くぶつけられた AI は、少しのあいだハンドルで立て直せない
        if (imp > 5) {
          if (!a.isPlayer) a.stun = 0.4;
          if (!b.isPlayer) b.stun = 0.4;
        }
        if (a.isPlayer || b.isPlayer) {
          game.shake = Math.max(game.shake, 3);
          if (audio) beep(140, 0.08);
        }
      }
    }
  }

  // ---------------------------------------------------------------- 粒子（火花）
  const particles = [];
  function spawnBurst(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
      particles.push({
        x, y, z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 8, vz: Math.sin(a) * sp,
        fx: 0, fz: 0, life: 0.5 + Math.random() * 0.4,
      });
    }
  }

  function spawnSpark(c) {
    roadPoint(c.s, c.lat, tmpB);
    TrackLib.sample(T, c.s, tmpA);
    const side = Math.sign(c.lat) * 1.3;
    particles.push({
      x: tmpB.x + tmpA.rx * side, y: tmpB.y + 0.3, z: tmpB.z + tmpA.rz * side,
      vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 6,
      fx: Math.sin(tmpA.th) * c.v * 0.8, fz: Math.cos(tmpA.th) * c.v * 0.8,
      life: 0.35 + Math.random() * 0.2,
    });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy -= 18 * dt;
      p.x += (p.vx + p.fx) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + p.fz) * dt;
    }
  }

  // ---------------------------------------------------------------- 景色（地上の木・岩・風車）と鉄塔
  const scenery = [];
  const pillars = [];
  function rng(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function nearTrack(x, z, r) {
    for (let i = 0; i < T.N; i += 3) {
      if (Math.abs(T.X[i] - x) < r && Math.abs(T.Z[i] - z) < r && Math.hypot(T.X[i] - x, T.Z[i] - z) < r) return true;
    }
    return false;
  }
  function buildWorld() {
    const r = rng(7 + courseIndex * 101);
    const kinds = ART.kinds;
    scenery.length = 0;
    pillars.length = 0;
    let tries = 0;
    while (scenery.length < 320 && tries++ < 5000) {
      const i = Math.floor(r() * T.N);
      const side = r() < 0.5 ? -1 : 1;
      const off = 16 + r() * r() * 260;
      const hx = Math.cos(T.TH[i]), hz = -Math.sin(T.TH[i]);
      const x = T.X[i] + hx * off * side + (r() - 0.5) * 30;
      const z = T.Z[i] + hz * off * side + (r() - 0.5) * 30;
      if (nearTrack(x, z, 13)) continue;
      let pick = r(), k = kinds[0];
      for (const kd of kinds) { if (pick < kd.w) { k = kd; break; } pick -= kd.w; }
      scenery.push({ x, z, img: k.img, h: k.h * (0.8 + r() * 0.45), flip: r() < 0.5 });
    }
    // 鉄塔は 16m ごと、路面の左右の下に立てる。下を別の路面が通る所には立てない
    for (let i = 0; i < T.N; i += 8) {
      if (T.Y[i] < 4) continue;
      for (const side of [-0.62, 0.62]) {
        const m = side * HALF_W;
        const x = T.X[i] + T.RX[i] * m, z = T.Z[i] + T.RZ[i] * m;
        const top = T.Y[i] + T.RY[i] * m - DECK_TH;
        let blocked = false;
        for (let j = 0; j < T.N; j += 2) {
          const ds = Math.min(Math.abs(j - i), T.N - Math.abs(j - i));
          if (ds < 20) continue;
          if (T.Y[j] < top && Math.hypot(T.X[j] - x, T.Z[j] - z) < HALF_W + 3) { blocked = true; break; }
        }
        if (!blocked) pillars.push({ i, x, z, top });
      }
    }
  }

  // ---------------------------------------------------------------- カメラと投影
  const cam = {
    x: 0, y: 30, z: 0, fx: 0, fy: 0, fz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0,
    roll: 0, pitch: 0, yaw: 0, yawUnwrapped: 0, prevYaw: null, fallBlend: 0, fallCam: null, trackY: undefined,
  };

  function updateCamera(player, dt, snap) {
    const back = 8.5;
    TrackLib.sample(T, player.s - back, tmpA);
    const latM = player.lat * LAT_RANGE * 0.65;
    const px = tmpA.x + tmpA.rx * latM, pz = tmpA.z + tmpA.rz * latM;
    const roadY = tmpA.y + tmpA.ry * latM;
    const bank = tmpA.bank;
    // 落下中は player.y が路面より下になるので、コース上のカメラの高さには使わない
    const carY = player.fall ? roadY : player.y;
    const wantY = Math.max(carY + 3.4, roadY + 2.4);
    cam.trackY = snap || cam.trackY === undefined ? wantY : cam.trackY + (wantY - cam.trackY) * Math.min(1, dt * 7);
    cam.trackY = Math.max(cam.trackY, roadY + 1.6);
    cam.x = px;
    cam.z = pz;
    cam.y = cam.trackY;

    TrackLib.sample(T, player.s + 16, tmpA);
    const lx = tmpA.x + tmpA.rx * player.lat * LAT_RANGE * 0.4;
    const lz = tmpA.z + tmpA.rz * player.lat * LAT_RANGE * 0.4;
    let ly = (tmpA.y + carY) / 2 + 0.6;
    let tx = lx, tz = lz;
    // 落下中は、カメラが道路の外側へ出て、落ちていく車を斜め後ろ上から追う（復帰したら戻る）
    const f = player.fall;
    cam.fallBlend = snap ? 0 : f ? Math.min(1, cam.fallBlend + dt * 2.5) : Math.max(0, cam.fallBlend - dt * 3);
    if (f) {
      const sn = Math.sin(f.th), cs = Math.cos(f.th);
      cam.fallCam = { x: f.x - sn * 12 + cs * f.side * 6, y: f.y + 6, z: f.z - cs * 12 - sn * f.side * 6, lx: f.x, ly: f.y + 0.5, lz: f.z };
    }
    if (cam.fallBlend > 0 && cam.fallCam) {
      const b = cam.fallBlend * cam.fallBlend * (3 - 2 * cam.fallBlend), fc = cam.fallCam;
      cam.x += (fc.x - cam.x) * b;
      cam.y += (fc.y - cam.y) * b;
      cam.z += (fc.z - cam.z) * b;
      tx += (fc.lx - tx) * b;
      ly += (fc.ly - ly) * b;
      tz += (fc.lz - tz) * b;
    }
    let fx = tx - cam.x, fy = ly - cam.y, fz = tz - cam.z;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    const hl = Math.hypot(fx, fz);
    const hx = fz / hl, hz = -fx / hl; // 水平な右方向
    // U0 = F × right
    const u0x = fy * hz - fz * 0, u0y = fz * hx - fx * hz, u0z = fx * 0 - fy * hx;
    const wantRoll = (bank * 0.85 + player.steerVis * 0.035) * (1 - cam.fallBlend);
    cam.roll = snap ? wantRoll : cam.roll + (wantRoll - cam.roll) * Math.min(1, dt * 6);
    const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
    cam.fx = fx; cam.fy = fy; cam.fz = fz;
    cam.rx = cr * hx + sr * u0x; cam.ry = sr * u0y; cam.rz = cr * hz + sr * u0z;
    cam.ux = cr * u0x - sr * hx; cam.uy = cr * u0y; cam.uz = cr * u0z - sr * hz;
    cam.pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
    const yaw = Math.atan2(fx, fz);
    if (cam.prevYaw !== null) cam.yawUnwrapped += TrackLib.wrapAngle(yaw - cam.prevYaw);
    cam.prevYaw = yaw;
    cam.yaw = yaw;
  }

  const P = { x: 0, y: 0, z: 0, s: 0 };
  function project(x, y, z, out) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const cz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (cz < NEAR) return false;
    const cx = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    const cy = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    const s = FOCAL / cz;
    out.x = W / 2 + cx * s;
    out.y = H / 2 - cy * s;
    out.z = cz;
    out.s = s;
    return true;
  }

  // ---------------------------------------------------------------- 描画リスト
  // すべての物体は「画像・切り出し範囲・中心・幅・高さ・回転・反転」で表し、遠い順に描く
  const pool = [];
  let drawCount = 0;
  function sprite(z, img, sx, sy, sw, sh, x, y, w, h, rot, ax, ay, flipX, flipY, alpha) {
    let d = pool[drawCount];
    if (!d) d = pool[drawCount] = {};
    drawCount++;
    d.z = z; d.img = img; d.sx = sx; d.sy = sy; d.sw = sw; d.sh = sh;
    d.x = x; d.y = y; d.w = w; d.h = h; d.rot = rot; d.ax = ax; d.ay = ay;
    d.fx = flipX ? -1 : 1; d.fy = flipY ? -1 : 1; d.alpha = alpha;
    return d;
  }
  function byDepth(a, b) { return b.z - a.z; }

  function drawSprite(d) {
    const c = Math.cos(d.rot), s = Math.sin(d.rot);
    ctx.globalAlpha = d.alpha;
    // 拡大縮小と回転だけの変換行列（せん断なし）
    ctx.setTransform(c * d.fx, s * d.fx, -s * d.fy, c * d.fy, d.x, d.y);
    ctx.drawImage(d.img, d.sx, d.sy, d.sw, d.sh, -d.w * d.ax, -d.h * d.ay, d.w, d.h);
  }

  function fadeAlpha(z) {
    if (z < FADE_START) return 1;
    return Math.max(0, 1 - (z - FADE_START) / (VIEW_DIST - FADE_START));
  }

  // 投影済みの路面の左右端（各サンプル）
  let PL, PR;
  function allocProjection() {
    PL = { x: new Float64Array(T.N), y: new Float64Array(T.N), z: new Float64Array(T.N), ok: new Uint8Array(T.N) };
    PR = { x: new Float64Array(T.N), y: new Float64Array(T.N), z: new Float64Array(T.N) };
  }
  const pa = {}, pb = {}, pc = {}, pd = {};

  function collectRoad() {
    const vd2 = VIEW_DIST * VIEW_DIST;
    for (let i = 0; i < T.N; i++) {
      PL.ok[i] = 0;
      const dx = T.X[i] - cam.x, dz = T.Z[i] - cam.z;
      if (dx * dx + dz * dz > vd2) continue;
      // 視野の後ろはスキップ
      if (dx * cam.fx + (T.Y[i] - cam.y) * cam.fy + dz * cam.fz < NEAR - HALF_W) continue;
      const lx = T.X[i] - T.RX[i] * HALF_W, ly = T.Y[i] - T.RY[i] * HALF_W, lz = T.Z[i] - T.RZ[i] * HALF_W;
      const rx = T.X[i] + T.RX[i] * HALF_W, ry = T.Y[i] + T.RY[i] * HALF_W, rz = T.Z[i] + T.RZ[i] * HALF_W;
      if (!project(lx, ly, lz, pa) || !project(rx, ry, rz, pb)) continue;
      PL.x[i] = pa.x; PL.y[i] = pa.y; PL.z[i] = pa.z;
      PR.x[i] = pb.x; PR.y[i] = pb.y; PR.z[i] = pb.z;
      PL.ok[i] = 1;
    }
    const road = IMG.road, deck = IMG.deck;
    const rowsPerSeg = (road.height * T.seg) / ROAD_TEX_LEN;
    const deckColsPerSeg = (deck.width * T.seg) / DECK_TEX_LEN;
    for (let i = 0; i < T.N; i++) {
      const j = (i + 1) % T.N;
      if (!PL.ok[i] || !PL.ok[j]) continue;
      const z = (PL.z[i] + PR.z[i] + PL.z[j] + PR.z[j]) / 4;
      const alpha = fadeAlpha(z);
      if (alpha <= 0) continue;
      // 画面上の左右端ベクトル（スライスの幅と角度）
      const ex = PR.x[i] - PL.x[i], ey = PR.y[i] - PL.y[i];
      const ex2 = PR.x[j] - PL.x[j], ey2 = PR.y[j] - PL.y[j];
      const w = (Math.hypot(ex, ey) + Math.hypot(ex2, ey2)) / 2;
      const ang = Math.atan2(ey + ey2, ex + ex2);
      const m1x = (PL.x[i] + PR.x[i]) / 2, m1y = (PL.y[i] + PR.y[i]) / 2;
      const m2x = (PL.x[j] + PR.x[j]) / 2, m2y = (PL.y[j] + PR.y[j]) / 2;
      const cx = (m1x + m2x) / 2, cy = (m1y + m2y) / 2;
      if (cx + w < -40 || cx - w > W + 40 || cy + w < -200 || cy - w > H + 200) continue;
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      const hgt = Math.abs((m2x - m1x) * nx + (m2y - m1y) * ny) + 1.2;
      // カメラが路面より上なら舗装面、下なら裏側の鉄骨を描く
      const above = (cam.x - T.X[i]) * T.NX[i] + (cam.y - T.Y[i]) * T.NY[i] + (cam.z - T.Z[i]) * T.NZ[i] > 0;
      if (above) {
        const sy = (i % Math.round(ROAD_TEX_LEN / T.seg)) * rowsPerSeg;
        sprite(z, road, 0, sy, road.width, rowsPerSeg, cx, cy, w + 1, hgt, ang, 0.5, 0.5, false, false, alpha);
      } else {
        sprite(z, deck, (i * deckColsPerSeg) % (deck.width - deckColsPerSeg), deck.height * 0.55, deckColsPerSeg, deck.height * 0.4,
          cx, cy, w + 1, hgt, ang, 0.5, 0.5, false, false, alpha);
      }
      // 側面（橋桁）：カメラから見える側だけ
      const side = (cam.x - T.X[i]) * T.RX[i] + (cam.y - T.Y[i]) * T.RY[i] + (cam.z - T.Z[i]) * T.RZ[i];
      const sgn = side > HALF_W ? 1 : side < -HALF_W ? -1 : 0;
      if (sgn !== 0) addDeckSide(i, j, sgn, z, alpha, deckColsPerSeg);
    }
  }

  function addDeckSide(i, j, sgn, z, alpha, cols) {
    const m = sgn * HALF_W;
    const ax = T.X[i] + T.RX[i] * m, ay = T.Y[i] + T.RY[i] * m, az = T.Z[i] + T.RZ[i] * m;
    const bx = T.X[j] + T.RX[j] * m, by = T.Y[j] + T.RY[j] * m, bz = T.Z[j] + T.RZ[j] * m;
    if (!project(ax, ay, az, pa) || !project(bx, by, bz, pb)) return;
    if (!project(ax - T.NX[i] * DECK_TH, ay - T.NY[i] * DECK_TH, az - T.NZ[i] * DECK_TH, pc)) return;
    if (!project(bx - T.NX[j] * DECK_TH, by - T.NY[j] * DECK_TH, bz - T.NZ[j] * DECK_TH, pd)) return;
    const lx = pb.x - pa.x, ly = pb.y - pa.y;
    const len = Math.hypot(lx, ly);
    if (len < 0.3) return;
    const ang = Math.atan2(ly, lx);
    const tx = (pa.x + pb.x) / 2, ty = (pa.y + pb.y) / 2;
    const bxm = (pc.x + pd.x) / 2, bym = (pc.y + pd.y) / 2;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const dn = (bxm - tx) * nx + (bym - ty) * ny;
    // 下端が横にずれすぎる（ほぼ真横から見ている）ときは、長方形では表せないので描かない
    const along = (bxm - tx) * Math.cos(ang) + (bym - ty) * Math.sin(ang);
    if (Math.abs(along) > len * 0.6 + 2) return;
    const deck = IMG.deck;
    sprite(z + 0.05, deck, (i * cols) % (deck.width - cols), 0, cols, deck.height,
      (tx + bxm) / 2, (ty + bym) / 2, len + 1, Math.abs(dn) + 1, ang, 0.5, 0.5, false, dn < 0, alpha);
  }

  function collectPillars() {
    const img = IMG.pillar;
    const worldW = 2.2;
    const tileH = (worldW * img.height) / img.width;
    for (const p of pillars) {
      const dx = p.x - cam.x, dz = p.z - cam.z;
      if (dx * dx + dz * dz > VIEW_DIST * VIEW_DIST) continue;
      if (!project(p.x, p.top, p.z, pa)) continue;
      const alpha = fadeAlpha(pa.z);
      if (alpha <= 0) continue;
      const zSort = pa.z + 2.2;
      // 上から下へ、テクスチャ1枚ぶんずつ並べる
      let y0 = p.top;
      while (y0 > 0) {
        const y1 = Math.max(0, y0 - tileH);
        const frac = (y0 - y1) / tileH;
        if (!project(p.x, y0, p.z, pa) || !project(p.x, y1, p.z, pb)) break;
        const vx = pa.x - pb.x, vy = pa.y - pb.y;
        const len = Math.hypot(vx, vy);
        const rot = Math.atan2(vx, -vy);
        const w = worldW * (pa.s + pb.s) / 2;
        if (pb.x > -w && pb.x < W + w || pa.x > -w && pa.x < W + w) {
          sprite(zSort, img, 0, 0, img.width, img.height * frac, pa.x, pa.y, w, len + 0.8, rot, 0.5, 0, false, false, alpha);
        }
        y0 = y1;
      }
    }
  }

  function collectScenery() {
    const up = billboardRot();
    for (const o of scenery) {
      const dx = o.x - cam.x, dz = o.z - cam.z;
      if (dx * dx + dz * dz > VIEW_DIST * VIEW_DIST) continue;
      if (!project(o.x, 0, o.z, pa)) continue;
      const img = IMG[o.img];
      const h = o.h * pa.s, w = (h * img.width) / img.height;
      if (pa.x + h < 0 || pa.x - h > W || pa.y - h * 1.2 > H + 400) continue;
      sprite(pa.z, img, 0, 0, img.width, img.height, pa.x, pa.y, w, h, up, 0.5, 1, o.flip, false, fadeAlpha(pa.z));
    }
  }

  function billboardRot() {
    // ワールドの上方向が画面でどちらを向くか（カメラのロール）
    return Math.atan2(cam.ry, cam.uy);
  }

  function collectGate() {
    const img = IMG.gate;
    const lx = T.X[0] - T.RX[0] * (HALF_W + 0.6), ly = T.Y[0] - T.RY[0] * (HALF_W + 0.6), lz = T.Z[0] - T.RZ[0] * (HALF_W + 0.6);
    const rx = T.X[0] + T.RX[0] * (HALF_W + 0.6), ry = T.Y[0] + T.RY[0] * (HALF_W + 0.6), rz = T.Z[0] + T.RZ[0] * (HALF_W + 0.6);
    if (!project(lx, ly, lz, pa) || !project(rx, ry, rz, pb)) return;
    const gateH = ((HALF_W + 0.6) * 2 * img.height) / img.width;
    if (!project(T.X[0], T.Y[0] + gateH, T.Z[0], pc)) return;
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const w = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const h = Math.hypot(pc.x - mx, pc.y - my);
    if (w < 2) return;
    const z = (pa.z + pb.z) / 2;
    sprite(z - 0.5, img, 0, 0, img.width, img.height, mx, my, w, h, Math.atan2(pb.y - pa.y, pb.x - pa.x), 0.5, 1, false, false, fadeAlpha(z));
  }

  // タイヤのコマ：止まっていれば通常、ゆっくりなら溝送りと交互、速ければ回転ぶれ
  function wheelFrame(c) {
    if (c.v < 0.5) return 0;
    if (c.v > 14) return 2;
    return Math.floor(c.wheel / 0.45) % 2;
  }

  function collectFallingCar(c) {
    const f = c.fall;
    if (!project(f.x, f.y, f.z, pa)) return;
    // 横回転は 3 枚の絵（真後ろ・斜め・斜めの反転）を順に切り替え、縦回転は画像の回転で表す
    const yaw = ((f.spin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const seg = Math.floor(yaw / (Math.PI / 2)) % 4;
    const img = seg % 2 === 1 ? c.skin.turn[2] : c.skin.rear[2];
    const w = CAR_W * pa.s;
    const h = (w * img.height) / img.width;
    sprite(pa.z - 2.2, img, 0, 0, img.width, img.height, pa.x, pa.y, w, h,
      billboardRot() + f.spin * 0.45, 0.5, 0.6, seg === 3, false, fadeAlpha(pa.z));
  }

  function collectCars(cars) {
    for (const c of cars) {
      if (c.fall) { collectFallingCar(c); continue; }
      // 復帰直後は点滅させる
      if (c.blink > 0 && Math.floor(c.blink * 14) % 2 === 0) continue;
      roadPoint(c.s, c.lat, tmpB);
      const sxw = tmpB.x, szw = tmpB.z, roadY = tmpB.y;
      TrackLib.sample(T, c.s, tmpA);
      if (!project(sxw, c.y, szw, pa)) continue;
      if (pa.z > VIEW_DIST) continue;
      // カメラの直前を横切る車は半透明にして視界をふさがない
      const alpha = fadeAlpha(pa.z) * Math.max(0, Math.min(1, (pa.z - 4) / 3.5));
      if (alpha <= 0) continue;
      // 車体の傾き＝路面の右方向ベクトルの画面上の角度
      if (!project(sxw + tmpA.rx * 2, c.y + tmpA.ry * 2, szw + tmpA.rz * 2, pb)) continue;
      const rot = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      // 車の向きと視線の差でスプライトを選ぶ
      const heading = tmpA.th + Math.atan2(c.latVel, Math.max(8, c.v));
      const view = Math.atan2(sxw - cam.x, szw - cam.z);
      const rel = TrackLib.wrapAngle(heading - view) + (c.isPlayer ? c.steerVis * 0.25 : 0);
      const turned = Math.abs(rel) > 0.13;
      const img = (turned ? c.skin.turn : c.skin.rear)[wheelFrame(c)];
      const flip = turned && rel > 0;
      const w = CAR_W * pa.s * (turned ? 1.08 : 1);
      const h = (w * img.height) / img.width;
      const bounce = c.bump * Math.sin(game.time * 40) * 0.04 * h + (c.air ? 0 : Math.sin(game.time * 31 + c.index) * 0.008 * h * Math.min(1, c.v / 30));
      // 空中にいるときは路面に影を落とす
      if (c.y - roadY > 0.4 && project(sxw, roadY + 0.05, szw, pc)) {
        const sw = CAR_W * 1.3 * pc.s;
        sprite(pc.z - 2.1, IMG.shadow, 0, 0, 128, 64, pc.x, pc.y, sw, sw * 0.32, rot, 0.5, 0.5, false, false, alpha * 0.9);
      }
      sprite(pa.z - 2.2, img, 0, 0, img.width, img.height, pa.x, pa.y + bounce, w, h, rot, 0.5, 0.92, flip, false, alpha);
    }
  }

  function collectParticles() {
    for (const p of particles) {
      if (!project(p.x, p.y, p.z, pa)) continue;
      const sz = 0.5 * pa.s * (0.5 + p.life * 2);
      sprite(pa.z - 2.3, IMG.spark, 0, 0, 32, 32, pa.x, pa.y, sz, sz, 0, 0.5, 0.5, false, false, Math.min(1, p.life * 4));
    }
  }

  // ---------------------------------------------------------------- 空と地面
  function drawBackdrop() {
    const rot = billboardRot();
    const horizon = FOCAL * Math.tan(cam.pitch);
    const c = Math.cos(rot), s = Math.sin(rot);
    ctx.globalAlpha = 1;
    // 画面中心を原点に、カメラのロールぶん回した座標系で描く
    ctx.setTransform(c, s, -s, c, W / 2, H / 2);
    const R = 600; // 回転しても画面を覆う範囲

    const sky = ART.sky;
    const skyH = 470, skyW = (skyH * sky.width) / sky.height;
    const pxPerRad = (skyW * 2) / (Math.PI * 2);
    let off = (-cam.yawUnwrapped * pxPerRad) % (skyW * 2);
    if (off > 0) off -= skyW * 2;
    const skyTop = horizon + 8 - skyH;
    // 空画像の上端の行を引き伸ばして、画面上部の空を埋める
    if (skyTop > -R) ctx.drawImage(sky, 0, 0, sky.width, 2, -R, -R, R * 2, skyTop + R + 1);
    for (let k = 0, x = off - skyW * 2; x < R; k++, x += skyW) {
      if (x + skyW < -R) continue;
      // 偶数枚目は通常、奇数枚目は左右反転で並べると継ぎ目が出ない
      const odd = ((Math.round((x - off) / skyW) % 2) + 2) % 2 === 1;
      if (odd) {
        ctx.setTransform(-c, -s, -s, c, W / 2 + c * (x + skyW) - s * 0, H / 2 + s * (x + skyW));
        ctx.drawImage(sky, 0, 0, sky.width, sky.height, 0, skyTop, skyW, skyH);
        ctx.setTransform(c, s, -s, c, W / 2, H / 2);
      } else {
        ctx.drawImage(sky, 0, 0, sky.width, sky.height, x, skyTop, skyW, skyH);
      }
    }

    // 地面：距離ごとの横帯を、地面テクスチャの1行から引き伸ばして並べる
    const g = ART.groundTiled, tile = ART.ground.width;
    const camH = Math.max(4, cam.y);
    let y = Math.max(horizon, -R);
    while (y < R) {
      const dy = y - horizon;
      const band = dy < 30 ? 2 : dy < 120 ? 3 : 5;
      const d = (camH * FOCAL) / Math.max(0.5, dy + band * 0.5);
      const worldW = (2 * R * d) / FOCAL;
      const span = Math.min(2, worldW / GROUND_TILE);
      const along = ((game.groundScroll + d) / GROUND_TILE) % 1;
      let u = ((cam.yawUnwrapped * d * 0.9) / GROUND_TILE) % 1;
      if (u < 0) u += 1;
      const sy = (1 - along) * tile;
      const sh = Math.max(1, Math.min(tile, ((camH * FOCAL) / Math.max(0.5, dy) - (camH * FOCAL) / (dy + band)) / GROUND_TILE * tile));
      ctx.drawImage(g, u * tile, sy, span * tile, Math.min(sh, tile * 2), -R, y, R * 2, band + 0.6);
      y += band;
    }
    // 地平線付近のもや
    ctx.drawImage(ART.haze, 0, 0, 4, 128, -R, horizon - 6, R * 2, 90);
  }

  // ---------------------------------------------------------------- ゲーム進行
  const game = {
    state: 'loading', time: 0, raceTime: 0, countdown: 0, shake: 0,
    cars: [], player: null, groundScroll: 0, result: null, lastCount: 0,
  };
  window.__game = game;

  function resetRace() {
    const cars = [];
    const playerSlot = 5;
    for (let k = 0; k < 8; k++) {
      const isPlayer = k === playerSlot;
      // プレイヤーは元のオレンジ、AIは色違い
      const skin = isPlayer ? 0 : k < playerSlot ? k + 1 : k;
      cars.push(makeCar(skin, isPlayer, Math.floor(k / 2), k % 2));
    }
    for (const c of cars) {
      roadPoint(c.s, c.lat, tmpB);
      c.y = tmpB.y;
    }
    game.cars = cars;
    game.player = cars[playerSlot];
    game.raceTime = 0;
    game.result = null;
    particles.length = 0;
    updateCamera(game.player, 0, true);
  }

  function setCourse(i) {
    courseIndex = i;
    T = TrackLib.build(i);
    ART = IMG.courseArt[i];
    allocProjection();
    buildWorld();
    cam.prevYaw = null;
    resetRace();
  }

  function changeCourse(d) {
    setCourse((courseIndex + d + TrackLib.COURSES.length) % TrackLib.COURSES.length);
    beep(620, 0.06);
  }

  function goTitle() {
    game.state = 'title';
    resetRace();
  }

  function loadBest(i) {
    try { return Number(localStorage.getItem('skyway-best-' + i)) || 0; } catch (e) { return 0; }
  }
  function saveBest(i, t) {
    try { localStorage.setItem('skyway-best-' + i, String(t)); } catch (e) { /* 保存できなくても遊べる */ }
  }

  function lapOf(c) {
    return Math.max(0, Math.floor(c.s / T.length));
  }

  function step(dt) {
    game.time += dt;
    const { cars, player } = game;
    const racing = game.state === 'race' || game.state === 'finish' || game.state === 'title';
    if (game.state === 'countdown') {
      game.countdown -= dt;
      const n = Math.ceil(game.countdown);
      if (n !== game.lastCount && n >= 0) {
        game.lastCount = n;
        beep(n === 0 ? 880 : 440, n === 0 ? 0.6 : 0.2);
      }
      if (game.countdown <= 0) game.state = 'race';
    }
    if (racing) {
      if (game.state === 'race') game.raceTime += dt;
      for (const c of cars) {
        if (c.fall) {
          // 落下中は操作しない
        } else if (c.isPlayer && game.state === 'race' && !c.finished) {
          updatePlayer(c, AUTOPILOT ? autopilotInput(c, cars) : readInput(), dt);
        } else if (c.isPlayer) {
          // タイトル画面のデモ走行とゴール後は自動操縦
          updatePlayer(c, autopilotInput(c, cars), dt);
        } else {
          updateAI(c, cars, player, dt);
        }
        c.blink = Math.max(0, c.blink - dt);
        c.wheel += c.v * dt;
        if (c.fall) { updateFall(c, dt); continue; }
        const before = lapOf(c);
        c.s += c.v * dt;
        updateVertical(c, dt);
        c.bump = Math.max(0, c.bump - dt * 2.5);
        if (game.state === 'race' && c.s > 0 && lapOf(c) > before) onLap(c);
      }
      collide(cars);
    }
    updateCamera(player, dt, false);
    updateParticles(dt);
    game.groundScroll += player.v * dt;
    game.shake = Math.max(0, game.shake - dt * 12);
  }

  function onLap(c) {
    const lapTime = game.raceTime - c.lapStart;
    c.lastLap = lapTime;
    if (!c.bestLap || lapTime < c.bestLap) c.bestLap = lapTime;
    c.lapStart = game.raceTime;
    c.lap = lapOf(c);
    if (c.lap >= LAPS && !c.finished) {
      c.finished = true;
      c.finishTime = game.raceTime;
      c.place = game.cars.filter((o) => o.finished).length;
      if (c.isPlayer) {
        game.state = 'finish';
        const prev = loadBest(courseIndex);
        const record = !prev || c.finishTime < prev;
        if (record) saveBest(courseIndex, c.finishTime);
        game.result = { place: c.place, time: c.finishTime, best: c.bestLap, record };
        game.finishAt = game.time;
        beep(660, 0.3);
        setTimeout(() => beep(990, 0.5), 180);
      }
    } else if (c.isPlayer) {
      beep(760, 0.15);
    }
  }

  function standing(c) {
    let p = 1;
    for (const o of game.cars) {
      if (o === c) continue;
      if (o.finished && (!c.finished || o.finishTime < c.finishTime)) p++;
      else if (!o.finished && !c.finished && o.s > c.s) p++;
    }
    return p;
  }

  // ---------------------------------------------------------------- 画面
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackdrop();
    drawCount = 0;
    collectRoad();
    collectPillars();
    collectScenery();
    collectGate();
    collectCars(game.cars);
    collectParticles();
    const list = pool.slice(0, drawCount).sort(byDepth);
    // 画面揺れ（衝突・着地）
    const sx = (Math.random() - 0.5) * game.shake, sy = (Math.random() - 0.5) * game.shake;
    for (const d of list) {
      d.x += sx;
      d.y += sy;
      drawSprite(d);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    game.lastDrawCount = drawCount;
    drawHud();
  }

  function fmt(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}'${s.toFixed(2).padStart(5, '0')}"`;
  }

  function text(str, x, y, size, color, align, italic) {
    ctx.font = `${italic === false ? '' : 'italic '}900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(10,20,50,0.9)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function ordinal(n) {
    return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  }

  function drawLogo(cx, cy, scale) {
    const img = IMG.logo;
    const w = 560 * scale, h = (w * img.height) / img.width;
    const rot = Math.sin(game.time * 1.7) * 0.03;
    ctx.setTransform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), cx, cy);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawHud() {
    const p = game.player;
    if (game.state === 'title') {
      drawLogo(W / 2, 150, 0.9 + Math.sin(game.time * 3) * 0.02);
      const n = TrackLib.COURSES.length;
      text(`COURSE ${courseIndex + 1}/${n}`, W / 2, 300, 20, '#cfe6ff', 'center', false);
      text(`◀  ${T.name}  ▶`, W / 2, 344, 40, '#ffe14d', 'center');
      const best = loadBest(courseIndex);
      text(`${(T.length / 1000).toFixed(1)} km  ·  ${LAPS} LAPS${best ? '  ·  BEST ' + fmt(best) : ''}`, W / 2, 374, 17, '#fff', 'center', false);
      if (Math.floor(game.time * 2) % 2 === 0) {
        text(COARSE ? '◀ ▶ COURSE    A START' : 'PRESS ENTER TO START', W / 2, 432, 28, '#fff', 'center');
      }
      if (!COARSE) text('←→ COURSE / STEER   ↑/Z ACCEL   ↓/X BRAKE   M SOUND', W / 2, 505, 16, '#cfe6ff', 'center', false);
      return;
    }
    const lap = Math.min(LAPS, lapOf(p) + 1);
    text(`LAP ${lap}/${LAPS}`, 24, 44, 30, '#ffe14d');
    text(`TIME ${fmt(game.raceTime)}`, 24, 78, 22, '#fff');
    if (p.lastLap) text(`LAST ${fmt(p.lastLap)}`, 24, 104, 16, '#cfe6ff', 'left', false);
    const pos = p.finished ? p.place : standing(p);
    text(ordinal(pos), W - 24, 58, 52, pos === 1 ? '#ffe14d' : '#fff', 'right');
    text('/8', W - 24, 84, 18, '#cfe6ff', 'right', false);
    const kmh = Math.round(p.v * 3.6);
    // タッチ操作の端末ではボタンと重ならないよう、速度を右上に出す
    const speedY = COARSE ? 148 : H - 26;
    text(`${kmh}`, W - 92, speedY, COARSE ? 40 : 54, '#fff', 'right');
    text('km/h', W - 24, speedY - 2, 20, '#ffe14d', 'right');
    if (game.state === 'countdown') {
      const n = Math.ceil(game.countdown);
      const f = game.countdown - Math.floor(game.countdown);
      const size = 90 + f * 60;
      text(n > 0 ? String(n) : 'GO!', W / 2, H / 2 - 40, size, n > 0 ? '#fff' : '#ffe14d', 'center');
    } else if (game.state === 'race' && game.raceTime < 1) {
      text('GO!', W / 2, H / 2 - 40, 120, '#ffe14d', 'center');
    }
    if (p.fall && p.fall.landed) text('COURSE OUT!', W / 2, 200, 60, '#ff5a3d', 'center');
    if (game.state === 'race' && p.lap === LAPS - 1 && game.raceTime - p.lapStart < 2.5) {
      text('FINAL LAP', W / 2, 150, 54, '#ff7a3d', 'center');
    }
    if (game.state === 'finish' && game.result) {
      const r = game.result;
      text('FINISH!', W / 2, 160, 84, '#ffe14d', 'center');
      text(`${ordinal(r.place)} PLACE`, W / 2, 235, 52, '#fff', 'center');
      text(`TOTAL ${fmt(r.time)}   BEST LAP ${fmt(r.best || 0)}`, W / 2, 285, 24, '#cfe6ff', 'center', false);
      if (r.record) text('NEW RECORD!', W / 2, 325, 30, '#ff7a3d', 'center');
      if (game.time - game.finishAt > 2 && Math.floor(game.time * 2) % 2 === 0) {
        text(COARSE ? 'A: RETRY    B: COURSE SELECT' : 'ENTER: RETRY    ESC: COURSE SELECT', W / 2, 420, 28, '#fff', 'center');
      }
    }
  }

  // ---------------------------------------------------------------- メインループ
  let acc = 0, last = 0;
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (pressedStart) {
      pressedStart = false;
      if (game.state === 'title' || (game.state === 'finish' && game.time - game.finishAt > 2)) {
        resetRace();
        game.state = 'countdown';
        game.countdown = 3.999;
        game.lastCount = 4;
      }
    }
    acc += dtReal;
    if (window.__freeze) acc = 0; // 検証用：実時間での進行を止める
    while (acc >= DT) {
      step(DT);
      acc -= DT;
    }
    updateAudio(game.player, game.state !== 'title');
    render();
    requestAnimationFrame(frame);
  }

  async function start() {
    const entries = Object.entries(FILES);
    const imgs = await Promise.all(entries.map(([, src]) => loadImage(src)));
    entries.forEach(([k], i) => { IMG[k] = imgs[i]; });
    makeAuxImages();
    const startCourse = Math.max(0, Math.min(TrackLib.COURSES.length - 1, Number(params.get('course') || 1) - 1));
    courseIndex = startCourse;
    ART = IMG.courseArt[startCourse];
    setCourse(startCourse);
    game.state = AUTOPILOT ? 'countdown' : 'title';
    if (AUTOPILOT) game.countdown = 3.999;
    document.body.classList.add('ready');
    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  window.__roadY = (c) => roadY(c);
  window.__setCourse = (i) => setCourse(i);
  window.__fall = () => { const p = game.player; p.lat = 1.01; p.latVel = 10; p.v = Math.max(p.v, 40); moveLateral(p, 0); };
  // 検証用：一定時間ぶんシミュレーションを進める
  window.__advance = (seconds) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) step(DT);
  };

  start().catch((e) => {
    document.getElementById('error').textContent = e.message;
  });
})();
