import React, { useEffect, useRef } from 'react';

interface TrailDot {
  x: number;
  y: number;
  size: number;
  life: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  color: string;
  cap?: string;
  trunk?: string;
  round: boolean;
  nearMissTriggered: boolean;
  variant: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  type: string;
  color: string;
  rot?: number;
  rotSpeed?: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinkle: number;
  spd: number;
}

// Simple synth audio to avoid triggering explosion/harsh sounds
const getAudioCtx = (() => {
  let ctx: AudioContext | null = null;
  return () => {
    if (!ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return ctx;
  };
})();

function playChime(freq: number, type: OscillatorType, duration: number) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // ignore audio errors if user hasn't interacted or if not supported
  }
}

export const SafeRunner: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // DOM Elements for UI
    const scoreEl = document.getElementById('sr-score');
    const highEl = document.getElementById('sr-highScore');
    const startSc = document.getElementById('sr-startScreen');
    const overSc = document.getElementById('sr-gameOverScreen');
    const finalEl = document.getElementById('sr-finalScore');
    const worldBadge = document.getElementById('sr-worldBadge');
    const nearMiss = document.getElementById('sr-nearMiss');
    const worldBanner = document.getElementById('sr-worldBanner');

    let W: number = 0, H: number = 0, GROUND_Y: number = 0;

    function resize() {
      if (!container || !canvas) return;
      const aspect = 16 / 9;
      const rect = container.getBoundingClientRect();
      let w = rect.width;
      let h = rect.height;
      
      if (w / h > aspect) w = h * aspect;
      else h = w / aspect;
      
      canvas.width = Math.min(960, Math.floor(w));
      canvas.height = Math.min(540, Math.floor(h));
      W = canvas.width;
      H = canvas.height;
      GROUND_Y = H - Math.round(H * 0.12);
    }
    resize();
    window.addEventListener('resize', resize);

    // ============================================================
    // WORLD DEFINITIONS
    // ============================================================
    const WORLDS = [
      {
        name: 'Forest',
        bg: { top: '#0a1508', bottom: '#152a10', ground: '#253d18', groundLine: '#3a5e28', skyAccent: '#1a3a12', particles: true, particleType: 'leaf' },
        player: { color: '#8bc34a', eyeColor: '#ffffff', size: 28 },
        obstacles: [
          { type: 'tree', color: '#3d6b32', trunk: '#6b4423', minH: 45, maxH: 95, minW: 14, maxW: 30 },
          { type: 'rock', color: '#7a8a6a', minH: 18, maxH: 38, minW: 24, maxW: 52, round: true },
          { type: 'bush', color: '#4a8a2e', minH: 22, maxH: 36, minW: 32, maxW: 60 }
        ],
        colorPalette: ['#253d18','#3d6b32','#4a8a2e','#8bc34a','#6b4423','#c8e6c9'],
        spawnWeights: [0.50, 0.28, 0.22]
      },
      {
        name: 'Ocean',
        bg: { top: '#071220', bottom: '#0c2d50', ground: '#165f78', groundLine: '#2690a8', skyAccent: '#0a2035', particles: true, particleType: 'bubble' },
        player: { color: '#4dd0e1', eyeColor: '#ffffff', size: 28 },
        obstacles: [
          { type: 'coral', color: '#e57373', minH: 30, maxH: 62, minW: 18, maxW: 34, round: true },
          { type: 'shell', color: '#ffcc80', minH: 14, maxH: 24, minW: 20, maxW: 38, round: true },
          { type: 'seaweed', color: '#81c784', minH: 52, maxH: 105, minW: 10, maxW: 22 }
        ],
        colorPalette: ['#165f78','#4dd0e1','#e57373','#81c784','#ffcc80','#b2ebf2'],
        spawnWeights: [0.48, 0.32, 0.20]
      },
      {
        name: 'Space',
        bg: { top: '#040410', bottom: '#08081c', ground: '#101028', groundLine: '#1a1a40', skyAccent: '#060615', stars: true, starCount: 140, particles: false },
        player: { color: '#ce93d8', eyeColor: '#ffffff', size: 28 },
        obstacles: [
          { type: 'asteroid', color: '#78909c', minH: 24, maxH: 52, minW: 24, maxW: 52, round: true },
          { type: 'satellite', color: '#90a4ae', minH: 20, maxH: 36, minW: 20, maxW: 36 },
          { type: 'comet', color: '#b3e5fc', minH: 16, maxH: 30, minW: 16, maxW: 30, round: true }
        ],
        colorPalette: ['#101028','#ce93d8','#b3e5fc','#78909c','#90a4ae','#e1bee7'],
        spawnWeights: [0.45, 0.30, 0.25]
      },
      {
        name: 'Meadow',
        bg: { top: '#160828', bottom: '#260d48', ground: '#3c1870', groundLine: '#5c28a0', skyAccent: '#1a0a38', particles: true, particleType: 'firefly' },
        player: { color: '#f48fb1', eyeColor: '#ffffff', size: 28 },
        obstacles: [
          { type: 'mushroom', color: '#ef5350', cap: '#ff7043', minH: 26, maxH: 50, minW: 20, maxW: 40 },
          { type: 'stump', color: '#795548', minH: 22, maxH: 42, minW: 30, maxW: 56 },
          { type: 'log', color: '#6d4c41', minH: 16, maxH: 26, minW: 34, maxW: 64 }
        ],
        colorPalette: ['#3c1870','#f48fb1','#ff7043','#795548','#ce93d8','#f8bbd9'],
        spawnWeights: [0.40, 0.35, 0.25]
      }
    ];

    let state = 'start'; // 'start' | 'playing' | 'dead'
    let score = 0;
    let highScore = 0;
    let frameCount = 0;
    let worldIdx = 0;
    let speed = 4;
    const BASE_SPEED = 4;
    const SPEED_INC = 0.0015;
    const SPEED_MAX = 13;
    const SCORE_WORLD = 300;

    let shakeX = 0, shakeY = 0, shakeIntensity = 0;
    let worldTransitionAlpha = 0;
    let worldBannerTimer = 0;
    let nearMissTimer = 0;
    let animationId: number;

    try {
      const s = localStorage.getItem('saferunner_v2_best');
      if (s) highScore = parseInt(s) || 0;
    } catch { /* ignore */ }

    function persistBest() {
      try { localStorage.setItem('saferunner_v2_best', highScore.toString()); } catch { /* ignore */ }
    }
    if (highEl) highEl.textContent = 'BEST: ' + highScore;

    function world() { return WORLDS[worldIdx % WORLDS.length]; }

    function advanceWorld() {
      worldIdx = (worldIdx + 1) % WORLDS.length;
      worldTransitionAlpha = 1.0;
      worldBannerTimer = 110;
      buildStars();
    }

    const p = {
      x: 0, y: 0, vy: 0, w: 28, h: 28,
      grounded: true, jumpForce: -11.5, gravity: 0.55,
      squash: 1, stretch: 1, blinkTimer: 0, isBlinking: false,
      trail: [] as TrailDot[]
    };

    let obstacles: Obstacle[] = [];
    let spawnTimer = 0;
    const SPAWN_BASE = 88;

    function pickObstacleDef() {
      const w = world().spawnWeights;
      const r = Math.random(), len = w.length;
      let acc = 0;
      for (let i = 0; i < len; i++) { acc += w[i]; if (r < acc) return i; }
      return len - 1;
    }

    function spawnObstacle() {
      const def = world().obstacles[pickObstacleDef()] as { type: string; color: string; minH: number; maxH: number; minW: number; maxW: number; round?: boolean; cap?: string; trunk?: string; };
      const h = def.minH + Math.random() * (def.maxH - def.minH);
      const w = def.minW + Math.random() * (def.maxW - def.minW);
      obstacles.push({
        x: W + 24, y: GROUND_Y - h, w, h,
        type: def.type, color: def.color, cap: def.cap, trunk: def.trunk, round: def.round || false,
        nearMissTriggered: false, variant: Math.floor(Math.random() * 3)
      });
    }

    function resetGame() {
      score = 0; frameCount = 0; speed = BASE_SPEED;
      worldIdx = 0; worldTransitionAlpha = 0; worldBannerTimer = 0;
      obstacles = []; spawnTimer = 0; shakeIntensity = 0; nearMissTimer = 0;
      p.x = Math.round(W * 0.15); p.y = GROUND_Y - p.h; p.vy = 0;
      p.grounded = true; p.squash = 1; p.stretch = 1; p.trail = [];
    }

    function jump() {
      // Must interact to allow audio context
      getAudioCtx();

      if (state === 'start') {
        state = 'playing';
        if (startSc) startSc.classList.add('fade-out');
        if (overSc) overSc.classList.remove('show');
        resetGame();
        return;
      }
      if (state === 'dead') {
        state = 'playing';
        if (overSc) overSc.classList.remove('show');
        resetGame();
        return;
      }
      if (state === 'playing' && p.grounded) {
        p.vy = p.jumpForce * (0.92 + Math.random() * 0.16);
        p.grounded = false; p.squash = 1.35; p.stretch = 0.68;
        playChime(350, 'sine', 0.15); // soft jump sound
        for (let i = 0; i < 6; i++) {
          particles.push({
            x: p.x + p.w * 0.5 + (Math.random() - 0.5) * p.w,
            y: p.y + p.h,
            vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2,
            size: 3 + Math.random() * 4, life: 1, alpha: 0.6,
            color: world().bg.groundLine, type: 'dust'
          });
        }
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        jump();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('pointerdown', jump);
    if (startSc) startSc.addEventListener('pointerdown', jump);
    if (overSc) overSc.addEventListener('pointerdown', jump);

    const particles: Particle[] = [];
    function spawnBgParticle() {
      const w = world();
      if (!w.bg.particles) return;
      particles.push({
        x: W + Math.random() * 30, y: Math.random() * GROUND_Y * 0.9,
        vx: -speed * (0.25 + Math.random() * 0.3), vy: (Math.random() - 0.5) * 0.4,
        size: 3 + Math.random() * 5, alpha: 0.25 + Math.random() * 0.55,
        rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.06,
        life: 1, type: w.bg.particleType || 'dust', color: w.colorPalette[Math.floor(Math.random() * w.colorPalette.length)]
      });
    }

    let stars: Star[] = [];
    function buildStars() {
      stars = [];
      const w = world();
      if (!w.bg.stars) return;
      const n = w.bg.starCount || 140;
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * GROUND_Y,
          size: Math.random() < 0.12 ? 2 : 1,
          twinkle: Math.random() * Math.PI * 2, spd: 0.015 + Math.random() * 0.035
        });
      }
    }

    function rrect(x: number, y: number, w: number, h: number, r: number) {
      ctx!.beginPath();
      ctx!.roundRect(x, y, w, h, r);
      ctx!.fill();
    }
    function trailCircle(x: number, y: number, r: number) {
      ctx!.beginPath();
      ctx!.arc(x, y, r, 0, Math.PI * 2);
      ctx!.fill();
    }

    function drawBg() {
      const w = world(), b = w.bg;
      const grad = ctx!.createLinearGradient(0, 0, 0, GROUND_Y);
      grad.addColorStop(0, b.top);
      grad.addColorStop(1, b.bottom);
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, W, GROUND_Y);

      ctx!.fillStyle = b.skyAccent || b.top;
      ctx!.beginPath();
      const po = (frameCount * speed * 0.08) % 200;
      for (let x = -po; x < W + 200; x += 200) {
        ctx!.moveTo(x, GROUND_Y);
        ctx!.lineTo(x + 50, GROUND_Y - 60 - Math.sin(x * 0.015) * 20);
        ctx!.lineTo(x + 100, GROUND_Y - 40 - Math.cos(x * 0.02) * 15);
        ctx!.lineTo(x + 150, GROUND_Y - 55 - Math.sin(x * 0.01) * 25);
        ctx!.lineTo(x + 200, GROUND_Y);
      }
      ctx!.fill();

      stars.forEach(s => {
        const tw = 0.5 + 0.5 * Math.sin(s.twinkle);
        ctx!.globalAlpha = tw * 0.85;
        ctx!.fillStyle = '#ffffff';
        trailCircle(s.x, s.y, s.size);
        s.x -= speed * s.spd; s.twinkle += 0.04;
        if (s.x < -4) s.x = W + 4;
      });
      ctx!.globalAlpha = 1;
    }

    function drawGround() {
      const b = world().bg;
      ctx!.fillStyle = b.ground;
      ctx!.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      const off = (frameCount * speed) % 50;
      ctx!.strokeStyle = b.groundLine; ctx!.lineWidth = 2; ctx!.lineCap = 'round';
      for (let x = -off; x < W + 50; x += 50) {
        ctx!.beginPath(); ctx!.moveTo(x, GROUND_Y + 9); ctx!.lineTo(x + 25, GROUND_Y + 9); ctx!.stroke();
      }
      ctx!.strokeStyle = b.groundLine; ctx!.lineWidth = 3;
      ctx!.beginPath(); ctx!.moveTo(0, GROUND_Y); ctx!.lineTo(W, GROUND_Y); ctx!.stroke();
    }

    function drawPlayer() {
      const s = world().player.size, col = world().player.color, eye = world().player.eyeColor;
      ctx!.save(); ctx!.translate(p.x + s / 2 + shakeX, p.y + s / 2 + shakeY); ctx!.scale(p.squash, p.stretch);
      ctx!.globalAlpha = 0.18; ctx!.fillStyle = '#000';
      ctx!.beginPath(); ctx!.ellipse(0, s * 0.45, s * 0.4, s * 0.12, 0, 0, Math.PI * 2); ctx!.fill();
      ctx!.globalAlpha = 1;
      ctx!.fillStyle = col; rrect(-s / 2, -s / 2, s, s, s * 0.22);
      const eyeY = -s * 0.06, eyeS = s * 0.17; ctx!.fillStyle = eye;
      if (p.isBlinking) {
        ctx!.strokeStyle = eye; ctx!.lineWidth = eyeS * 0.5; ctx!.lineCap = 'round';
        ctx!.beginPath();
        ctx!.moveTo(-s * 0.22, eyeY); ctx!.lineTo(-s * 0.22 + eyeS, eyeY);
        ctx!.moveTo(s * 0.04, eyeY); ctx!.lineTo(s * 0.04 + eyeS, eyeY);
        ctx!.stroke();
      } else {
        rrect(-s * 0.22, eyeY - eyeS / 2, eyeS, eyeS, eyeS * 0.45);
        rrect(s * 0.04, eyeY - eyeS / 2, eyeS, eyeS, eyeS * 0.45);
        ctx!.fillStyle = '#222'; const ps = eyeS * 0.45;
        rrect(-s * 0.18, eyeY - ps / 2, ps, ps, ps * 0.4);
        rrect(s * 0.08, eyeY - ps / 2, ps, ps, ps * 0.4);
      }
      ctx!.restore();
      p.squash += (1 - p.squash) * 0.18; p.stretch += (1 - p.stretch) * 0.18;
    }

    function drawObstacle(o: Obstacle) {
      const { x, y, w, h, type, color, round, cap, trunk } = o;
      if (type === 'tree') {
        ctx!.fillStyle = trunk || '#6b4423';
        const tW = w * 0.28, tH = h * 0.38;
        ctx!.fillRect(x + w / 2 - tW / 2, y + h - tH, tW, tH);
        ctx!.fillStyle = color;
        const cx = x + w / 2, base = y + h - tH, tH2 = h * 0.72;
        for (let tier = 0; tier < 3; tier++) {
          const spread = w * (0.65 - tier * 0.12), topY = base - tH2 * (tier / 3);
          ctx!.beginPath(); ctx!.moveTo(cx, topY); ctx!.lineTo(cx - spread, base + 2); ctx!.lineTo(cx + spread, base + 2); ctx!.fill();
        }
        return;
      }
      if (type === 'seaweed') {
        ctx!.strokeStyle = color; ctx!.lineWidth = w * 0.32; ctx!.lineCap = 'round';
        const segs = 5; ctx!.beginPath(); ctx!.moveTo(x + w / 2, y + h);
        for (let i = 1; i <= segs; i++) {
          const py = y + h - (h / segs) * i, px = x + w / 2 + Math.sin(frameCount * 0.035 + i * 0.9) * (i * 3.5);
          ctx!.lineTo(px, py);
        }
        ctx!.stroke(); return;
      }
      if (type === 'satellite') {
        ctx!.fillStyle = color; ctx!.beginPath(); ctx!.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = '#546e7a'; ctx!.fillRect(x - w * 0.9, y + h * 0.25, w * 0.8, h * 0.5); ctx!.fillRect(x + w, y + h * 0.25, w * 0.8, h * 0.5);
        ctx!.strokeStyle = '#78909c'; ctx!.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const lx = x - w * 0.9 + (i / 4) * w * 0.8; ctx!.beginPath(); ctx!.moveTo(lx, y + h * 0.25); ctx!.lineTo(lx, y + h * 0.75); ctx!.stroke();
          const rx = x + w + (i / 4) * w * 0.8; ctx!.beginPath(); ctx!.moveTo(rx, y + h * 0.25); ctx!.lineTo(rx, y + h * 0.75); ctx!.stroke();
        }
        return;
      }
      if (type === 'mushroom') {
        ctx!.fillStyle = '#ffe0b2'; ctx!.fillRect(x + w * 0.35, y + h * 0.6, w * 0.3, h * 0.4);
        ctx!.fillStyle = color; ctx!.beginPath(); ctx!.ellipse(x + w / 2, y + h * 0.42, w / 2, h * 0.44, 0, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = cap || color; ctx!.beginPath(); ctx!.ellipse(x + w / 2, y + h * 0.3, w * 0.5, h * 0.22, 0, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = 'rgba(255,255,255,0.7)';
        trailCircle(x + w * 0.28, y + h * 0.22, w * 0.09); trailCircle(x + w * 0.6, y + h * 0.28, w * 0.07); trailCircle(x + w * 0.72, y + h * 0.18, w * 0.05);
        return;
      }
      if (round) {
        ctx!.beginPath(); ctx!.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx!.fill();
      } else { rrect(x, y, w, h, 6); }
    }

    function drawParticle(pt: Particle) {
      ctx!.globalAlpha = pt.alpha * pt.life; ctx!.fillStyle = pt.color;
      if (pt.type === 'leaf') {
        ctx!.save(); ctx!.translate(pt.x, pt.y); ctx!.rotate(pt.rot || 0); ctx!.beginPath(); ctx!.ellipse(0, 0, pt.size, pt.size * 0.5, 0, 0, Math.PI * 2); ctx!.fill(); ctx!.restore(); return;
      }
      if (pt.type === 'bubble') {
        trailCircle(pt.x, pt.y, pt.size); ctx!.strokeStyle = pt.color; ctx!.globalAlpha = 0.25 * pt.life; ctx!.lineWidth = 1;
        ctx!.beginPath(); ctx!.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx!.stroke(); ctx!.globalAlpha = 1; return;
      }
      if (pt.type === 'firefly') {
        const flicker = 0.55 + 0.45 * Math.sin(frameCount * 0.09 + pt.x * 0.1);
        ctx!.globalAlpha = pt.alpha * pt.life * flicker; trailCircle(pt.x, pt.y, pt.size);
        const grd = ctx!.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.size * 3.5);
        grd.addColorStop(0, pt.color + 'aa'); grd.addColorStop(1, pt.color + '00');
        ctx!.globalAlpha = pt.life * flicker * 0.3; ctx!.fillStyle = grd; trailCircle(pt.x, pt.y, pt.size * 3.5); ctx!.globalAlpha = 1; return;
      }
      if (pt.type === 'dust') { ctx!.globalAlpha = pt.alpha * pt.life * 0.6; trailCircle(pt.x, pt.y, pt.size); ctx!.globalAlpha = 1; return; }
      trailCircle(pt.x, pt.y, pt.size);
    }

    function drawTrail() {
      p.trail.forEach((t: TrailDot) => { ctx!.globalAlpha = t.life * 0.35; ctx!.fillStyle = world().player.color; trailCircle(t.x, t.y, t.size * t.life); });
      ctx!.globalAlpha = 1;
    }

    function updateShake() {
      if (shakeIntensity > 0.1) {
        shakeX = (Math.random() - 0.5) * shakeIntensity; shakeY = (Math.random() - 0.5) * shakeIntensity; shakeIntensity *= 0.88;
      } else { shakeX = 0; shakeY = 0; shakeIntensity = 0; }
    }

    function collides() {
      const px = p.x + 5, py = p.y + 5, pw = p.w - 10, ph = p.h - 10;
      for (const o of obstacles) {
        if (px < o.x + o.w - 2 && px + pw > o.x + 2 && py < o.y + o.h - 2 && py + ph > o.y + 2) return true;
      }
      return false;
    }

    function checkNearMiss() {
      const threshold = 12, px = p.x + p.w, py = p.y + p.h / 2;
      for (const o of obstacles) {
        if (o.nearMissTriggered) continue;
        const dx = o.x - px, dy = Math.abs((o.y + o.h / 2) - py);
        if (dx > 0 && dx < threshold + 10 && dy < threshold + p.h / 2) {
          o.nearMissTriggered = true; score += 25; nearMissTimer = 60;
          playChime(600, 'sine', 0.1);
          setTimeout(() => playChime(800, 'sine', 0.3), 100);
          if (nearMiss) { nearMiss.classList.remove('sr-flash'); void nearMiss.offsetWidth; nearMiss.classList.add('sr-flash'); }
        }
      }
    }

    function die() {
      state = 'dead'; score = Math.floor(score);
      if (score > highScore) { highScore = score; persistBest(); if (highEl) highEl.textContent = 'BEST: ' + highScore; }
      if (finalEl) finalEl.textContent = 'Score: ' + score; shakeIntensity = 14;
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        particles.push({
          x: p.x + p.w / 2, y: p.y + p.h / 2, vx: Math.cos(angle) * (2 + Math.random() * 3), vy: Math.sin(angle) * (2 + Math.random() * 3),
          size: 4 + Math.random() * 6, alpha: 0.7, life: 1, color: world().player.color, type: 'dust'
        });
      }
      setTimeout(() => { if (overSc) overSc.classList.add('show'); }, 400);
    }

    function update() {
      if (state !== 'playing') return;
      frameCount++; score += speed * 0.01;
      if (scoreEl) scoreEl.textContent = Math.floor(score).toString();

      const ws = Math.floor(score / SCORE_WORLD);
      if (ws > 0 && Math.floor((score - speed * 0.01) / SCORE_WORLD) < ws) advanceWorld();
      if (worldBadge) worldBadge.textContent = world().name;
      if (worldBannerTimer > 0) {
        worldBannerTimer--;
        if (worldBanner) { worldBanner.textContent = world().name; worldBanner.classList.remove('show'); void worldBanner.offsetWidth; worldBanner.classList.add('show'); }
      } else { if (worldBanner) worldBanner.classList.remove('show'); }

      speed = Math.min(BASE_SPEED + score * SPEED_INC, SPEED_MAX);
      p.vy += p.gravity; p.y += p.vy;
      if (p.y >= GROUND_Y - p.h) {
        p.y = GROUND_Y - p.h; p.vy = 0;
        if (!p.grounded) {
          p.squash = 0.72; p.stretch = 1.32;
          for (let i = 0; i < 5; i++) {
            particles.push({
              x: p.x + p.w * (0.3 + Math.random() * 0.4), y: p.y + p.h, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 2.5,
              size: 3 + Math.random() * 4, alpha: 0.6, life: 1, color: world().bg.groundLine, type: 'dust'
            });
          }
        }
        p.grounded = true;
      }
      p.blinkTimer++;
      if (!p.isBlinking && p.blinkTimer > 120 + Math.random() * 180) { p.isBlinking = true; p.blinkTimer = 0; }
      if (p.isBlinking && p.blinkTimer > 6) { p.isBlinking = false; p.blinkTimer = 0; }

      if (frameCount % 4 === 0) p.trail.push({ x: p.x + p.w * 0.3, y: p.y + p.h * 0.85, size: 5 + Math.random() * 3, life: 1 });
      for (let i = p.trail.length - 1; i >= 0; i--) { p.trail[i].life -= 0.07; if (p.trail[i].life <= 0) p.trail.splice(i, 1); }

      spawnTimer++; if (spawnTimer >= Math.max(48, SPAWN_BASE - Math.floor(score * 0.04))) { spawnObstacle(); spawnTimer = 0; }
      for (let i = obstacles.length - 1; i >= 0; i--) { obstacles[i].x -= speed; if (obstacles[i].x + obstacles[i].w < -30) obstacles.splice(i, 1); }

      if (Math.random() < 0.07) spawnBgParticle();
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]; pt.x += pt.vx; pt.y += pt.vy; if (pt.rot !== undefined) pt.rot += pt.rotSpeed || 0;
        pt.life -= pt.type === 'dust' ? 0.045 : 0.003; if (pt.x < -30 || pt.life <= 0) particles.splice(i, 1);
      }
      checkNearMiss(); if (nearMissTimer > 0) nearMissTimer--;
      updateShake(); if (collides()) die();
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H); ctx!.save(); ctx!.translate(shakeX, shakeY);
      drawBg(); particles.filter(pt => pt.type !== 'dust').forEach(drawParticle); drawTrail(); drawGround(); obstacles.forEach(drawObstacle); drawPlayer();
      if (worldTransitionAlpha > 0) { ctx!.globalAlpha = worldTransitionAlpha * 0.35; ctx!.fillStyle = world().colorPalette[0]; ctx!.fillRect(0, 0, W, H); ctx!.globalAlpha = 1; worldTransitionAlpha -= 0.012; }
      ctx!.restore();
      particles.filter(pt => pt.type === 'dust').forEach(drawParticle);
    }

    function loop() {
      update(); draw();
      animationId = requestAnimationFrame(loop);
    }

    p.x = Math.round(W * 0.15); p.y = GROUND_Y - p.h; buildStars();
    if (worldBadge) worldBadge.textContent = world().name;
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('pointerdown', jump);
      if (startSc) startSc.removeEventListener('pointerdown', jump);
      if (overSc) overSc.removeEventListener('pointerdown', jump);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div ref={containerRef} style={styles.wrap}>
      <canvas ref={canvasRef} style={styles.gameCanvas}></canvas>
      <div style={styles.ui}>
        <div id="sr-score" style={styles.score}>0</div>
        <div id="sr-highScore" style={styles.highScore}>BEST: 0</div>

        <div id="sr-startScreen" style={styles.startScreen}>
          <div style={styles.badge}></div>
          <h1 style={styles.h1}>Safe Runner</h1>
          <div style={styles.subtitle}>a quiet place to be</div>
          <div style={styles.hintRow}>
            <div style={styles.dot}></div>
            tap or press space to start
            <div style={styles.dot}></div>
          </div>
        </div>

        <div id="sr-gameOverScreen" className="sr-gameover" style={styles.gameOverScreen}>
          <h2 style={styles.h2}>Oops</h2>
          <div id="sr-finalScore" style={styles.finalScore}>Score: 0</div>
          <div style={styles.hintRow}>tap or press space to try again</div>
        </div>

        <div id="sr-worldBadge" className="sr-worldBadge" style={styles.worldBadge}></div>
        <div id="sr-nearMiss" className="sr-nearMiss" style={styles.nearMiss}>close!</div>
        <div id="sr-worldBanner" className="sr-worldBanner" style={styles.worldBanner}></div>
      </div>

      <style>{`
        .sr-gameover { opacity: 0; pointer-events: none; transition: opacity 0.5s; }
        .sr-gameover.show { opacity: 1; pointer-events: all; }
        #sr-startScreen { transition: opacity 0.4s; }
        #sr-startScreen.fade-out { opacity: 0; pointer-events: none; }
        .sr-worldBadge { opacity: 1; transition: opacity 0.5s; }
        .sr-worldBadge.hidden { opacity: 0; }
        .sr-nearMiss { opacity: 0; pointer-events: none; }
        .sr-nearMiss.sr-flash { animation: sr-near-miss-anim 0.6s ease-out forwards; }
        .sr-worldBanner { opacity: 0; pointer-events: none; }
        .sr-worldBanner.show { animation: sr-banner-anim 1.8s ease-out forwards; }
        @keyframes sr-near-miss-anim {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(0.8); }
          60% { opacity: 1; transform: translate(-50%, -70%) scale(1.1); }
          100% { opacity: 0; transform: translate(-50%, -90%) scale(1); }
        }
        @keyframes sr-banner-anim {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
          70% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
        }
      `}</style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0d1117',
    overflow: 'hidden',
    userSelect: 'none',
  },
  gameCanvas: {
    display: 'block',
    borderRadius: '6px',
    boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
  },
  ui: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none',
  },
  score: {
    position: 'absolute',
    top: '18px', right: '22px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '1px',
    textShadow: '0 2px 12px rgba(0,0,0,0.5)',
  },
  highScore: {
    position: 'absolute',
    top: '18px', left: '22px',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '13px',
    letterSpacing: '1px',
    textShadow: '0 2px 12px rgba(0,0,0,0.5)',
  },
  worldBadge: {
    position: 'absolute',
    bottom: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '11px',
    letterSpacing: '3px',
    textTransform: 'uppercase',
    textShadow: '0 2px 12px rgba(0,0,0,0.5)',
  },
  startScreen: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)',
    pointerEvents: 'all',
    cursor: 'pointer',
  },
  badge: {
    width: '60px', height: '60px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #8bc34a, #4dd0e1)',
    marginBottom: '20px',
    boxShadow: '0 4px 24px rgba(139,195,74,0.3)',
  },
  h1: {
    color: '#f5f5f5',
    fontSize: '40px',
    fontWeight: 800,
    letterSpacing: '5px',
    textTransform: 'uppercase',
    textShadow: '0 4px 24px rgba(0,0,0,0.5)',
    margin: 0,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: '14px',
    marginTop: '8px',
    letterSpacing: '1px',
    fontStyle: 'italic',
  },
  hintRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '36px',
    color: 'rgba(255,255,255,0.38)',
    fontSize: '12px',
    letterSpacing: '2px',
    textTransform: 'uppercase',
  },
  dot: {
    width: '6px', height: '6px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.4)',
  },
  gameOverScreen: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)',
    cursor: 'pointer',
  },
  h2: {
    color: '#f5f5f5',
    fontSize: '30px',
    fontWeight: 800,
    letterSpacing: '4px',
    textShadow: '0 4px 24px rgba(0,0,0,0.5)',
    margin: 0,
  },
  finalScore: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: '18px',
    marginTop: '12px',
  },
  nearMiss: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: 'rgba(255,255,255,0.9)',
    fontSize: '16px',
    fontWeight: 700,
    letterSpacing: '3px',
    textTransform: 'uppercase',
    textShadow: '0 2px 16px rgba(255,255,255,0.5)',
  },
  worldBanner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: 'rgba(255,255,255,0.95)',
    fontSize: '28px',
    fontWeight: 800,
    letterSpacing: '6px',
    textTransform: 'uppercase',
    textShadow: '0 4px 24px rgba(0,0,0,0.5)',
  }
};
