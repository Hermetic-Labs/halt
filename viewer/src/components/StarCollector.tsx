import React, { useEffect, useRef, useState } from 'react';

export const StarCollector: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  
  // Touch state
  const keys = useRef({ left: false, right: false, jump: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rawCtx = canvas.getContext('2d');
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;

    let w = 800;
    let h = 500;
    
    function resize() {
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w;
      canvas.height = h;
    }
    resize();
    window.addEventListener('resize', resize);

    const player = {
      x: 50, y: 50, vx: 0, vy: 0, width: 24, height: 24,
      speed: 4, jumpPower: -9, gravity: 0.4, grounded: false,
      color: '#f472b6' // pastel pink
    };

    const platforms = [
      { x: 0, y: h - 40, w: w * 2, h: 40 }, // Ground
      { x: 150, y: h - 120, w: 100, h: 15 },
      { x: 350, y: h - 200, w: 120, h: 15 },
      { x: 100, y: h - 280, w: 80, h: 15 },
      { x: 450, y: h - 320, w: 90, h: 15 },
      { x: 650, y: h - 180, w: 100, h: 15 },
      { x: 250, y: h - 400, w: 100, h: 15 },
    ];

    const stars = [
      { x: 190, y: h - 150, collected: false },
      { x: 400, y: h - 230, collected: false },
      { x: 130, y: h - 310, collected: false },
      { x: 490, y: h - 350, collected: false },
      { x: 690, y: h - 210, collected: false },
      { x: 290, y: h - 430, collected: false },
    ];

    let currentScore = 0;

    function resetLevel() {
      stars.forEach(s => s.collected = false);
      player.x = 50; player.y = 50; player.vx = 0; player.vy = 0;
      currentScore = 0;
      setScore(0);
    }

    function update() {
      // Horizontal movement
      if (keys.current.left) player.vx = -player.speed;
      else if (keys.current.right) player.vx = player.speed;
      else player.vx = 0;

      // Jump
      if (keys.current.jump && player.grounded) {
        player.vy = player.jumpPower;
        player.grounded = false;
        keys.current.jump = false; // consume jump
      }

      player.vy += player.gravity;
      player.x += player.vx;
      player.y += player.vy;

      // Screen wrap horizontal
      if (player.x > w) player.x = -player.width;
      if (player.x + player.width < 0) player.x = w;

      // Collision with platforms
      player.grounded = false;
      for (const p of platforms) {
        // Fall down onto platform
        if (player.vy >= 0 && 
            player.x < p.x + p.w && 
            player.x + player.width > p.x && 
            player.y + player.height >= p.y && 
            player.y + player.height <= p.y + p.h + player.vy + 2) {
          player.y = p.y - player.height;
          player.vy = 0;
          player.grounded = true;
        }
      }

      // Fall off bottom
      if (player.y > h + 100) {
        resetLevel();
      }

      // Collect stars
      let allCollected = true;
      for (const s of stars) {
        if (!s.collected) {
          allCollected = false;
          // Simple AABB collision
          if (player.x < s.x + 15 && player.x + player.width > s.x - 15 &&
              player.y < s.y + 15 && player.y + player.height > s.y - 15) {
            s.collected = true;
            currentScore++;
            setScore(currentScore);
          }
        }
      }

      if (allCollected) {
        setTimeout(resetLevel, 1000);
      }
    }

    function drawStar(cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) {
      let rot = Math.PI / 2 * 3;
      let x = cx;
      let y = cy;
      const step = Math.PI / spikes;

      ctx!.beginPath();
      ctx!.moveTo(cx, cy - outerRadius);
      for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx!.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx!.lineTo(x, y);
        rot += step;
      }
      ctx!.lineTo(cx, cy - outerRadius);
      ctx!.closePath();
      ctx!.fill();
    }

    let frames = 0;
    function draw() {
      if (!ctx) return;
      frames++;
      
      // Sky
      const grad = ctx.createLinearGradient(0,0,0,h);
      grad.addColorStop(0, '#2e1065'); // deep purple
      grad.addColorStop(1, '#4c1d95');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Platforms
      ctx.fillStyle = '#a78bfa'; // soft purple platforms
      platforms.forEach(p => {
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.w, p.h, 8);
        ctx.fill();
      });

      // Stars
      stars.forEach(s => {
        if (!s.collected) {
          ctx.fillStyle = '#fde047';
          ctx.save();
          ctx.translate(s.x, s.y + Math.sin(frames * 0.05 + s.x) * 5); // hover effect
          drawStar(0, 0, 5, 12, 5);
          ctx.restore();
        }
      });

      // Player
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.roundRect(player.x, player.y, player.width, player.height, 6);
      ctx.fill();
      
      // Player eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(player.x + 4 + (player.vx > 0 ? 4 : player.vx < 0 ? -2 : 0), player.y + 6, 4, 4);
      ctx.fillRect(player.x + 14 + (player.vx > 0 ? 4 : player.vx < 0 ? -2 : 0), player.y + 6, 4, 4);
    }

    let animationId: number;
    function loop() {
      update();
      draw();
      animationId = requestAnimationFrame(loop);
    }
    loop();

    // Keyboard support
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.current.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.current.right = true;
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') keys.current.jump = true;
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.current.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.current.right = false;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      cancelAnimationFrame(animationId);
    };
  }, []);

  const btnStyle = {
    width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
    border: '2px solid rgba(255,255,255,0.4)', color: '#fff', fontSize: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    userSelect: 'none' as const, touchAction: 'none' as const, backdropFilter: 'blur(4px)'
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#0d1117' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      
      {/* UI Overlay */}
      <div style={{ position: 'absolute', top: 20, left: 20, color: '#fde047', fontWeight: 800, fontSize: 24, textShadow: '0 2px 4px rgba(0,0,0,0.5)', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 32 }}>⭐</span> {score} / 6
      </div>

      {/* Touch Controls */}
      <div style={{ position: 'absolute', bottom: 30, left: 30, display: 'flex', gap: 16 }}>
        <div 
          style={btnStyle}
          onTouchStart={() => keys.current.left = true}
          onTouchEnd={() => keys.current.left = false}
          onMouseDown={() => keys.current.left = true}
          onMouseUp={() => keys.current.left = false}
          onMouseLeave={() => keys.current.left = false}
        >◀</div>
        <div 
          style={btnStyle}
          onTouchStart={() => keys.current.right = true}
          onTouchEnd={() => keys.current.right = false}
          onMouseDown={() => keys.current.right = true}
          onMouseUp={() => keys.current.right = false}
          onMouseLeave={() => keys.current.right = false}
        >▶</div>
      </div>

      <div style={{ position: 'absolute', bottom: 30, right: 30 }}>
        <div 
          style={{ ...btnStyle, width: 70, height: 70, background: 'rgba(244, 114, 182, 0.3)', border: '2px solid rgba(244, 114, 182, 0.6)' }}
          onTouchStart={() => keys.current.jump = true}
          onMouseDown={() => keys.current.jump = true}
        >▲</div>
      </div>
    </div>
  );
};
