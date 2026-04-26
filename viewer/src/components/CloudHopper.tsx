import React, { useEffect, useRef, useState } from 'react';

export const CloudHopper: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isDead, setIsDead] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    try {
      const best = localStorage.getItem('cloudhopper_best');
      if (best) setHighScore(parseInt(best, 10));
    } catch { /* ignore */ }
  }, []);

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

    // Game state
    let frames = 0;
    let currentScore = 0;
    let gameState = 'start'; // start, play, dead
    let pipes: { x: number; y: number; width: number; height: number; passed: boolean }[] = [];
    
    const bird = {
      x: w * 0.2,
      y: h / 2,
      vy: 0,
      radius: 14,
      gravity: 0.45,
      jump: -7.5,
      draw: () => {
        ctx.save();
        ctx.translate(bird.x, bird.y);
        ctx.rotate(Math.min(Math.PI / 4, Math.max(-Math.PI / 4, bird.vy * 0.1)));
        
        // Body (pastel yellow)
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Eye
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(6, -4, 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Wing
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.ellipse(-4, 2, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }
    };

    const pipeWidth = 60;
    const gap = 160;

    function reset() {
      bird.y = h / 2;
      bird.vy = 0;
      pipes = [];
      frames = 0;
      currentScore = 0;
      setScore(0);
      setIsDead(false);
    }

    function flap() {
      if (gameState === 'start') {
        gameState = 'play';
        setStarted(true);
      } else if (gameState === 'dead') {
        reset();
        gameState = 'play';
        setStarted(true);
      }
      if (gameState === 'play') {
        bird.vy = bird.jump;
      }
    }

    function update() {
      if (gameState !== 'play') return;
      frames++;

      // Bird physics
      bird.vy += bird.gravity;
      bird.y += bird.vy;

      // Floor / Ceiling collision
      if (bird.y + bird.radius >= h || bird.y - bird.radius <= 0) {
        die();
      }

      // Generate pipes
      if (frames % 100 === 0) {
        const minPipeHeight = 50;
        const maxPipeHeight = h - gap - minPipeHeight;
        const topHeight = Math.floor(Math.random() * (maxPipeHeight - minPipeHeight + 1) + minPipeHeight);
        
        pipes.push({
          x: w,
          y: 0,
          width: pipeWidth,
          height: topHeight,
          passed: false
        });
      }

      // Update pipes and collisions
      for (let i = 0; i < pipes.length; i++) {
        const p = pipes[i];
        p.x -= 3.5; // speed

        // Top pipe collision
        if (bird.x + bird.radius > p.x && bird.x - bird.radius < p.x + p.width &&
            bird.y - bird.radius < p.y + p.height) {
          die();
        }
        
        // Bottom pipe collision
        if (bird.x + bird.radius > p.x && bird.x - bird.radius < p.x + p.width &&
            bird.y + bird.radius > p.y + p.height + gap) {
          die();
        }

        // Score
        if (p.x + p.width < bird.x && !p.passed) {
          currentScore++;
          setScore(currentScore);
          p.passed = true;
        }
      }

      // Cleanup offscreen pipes
      if (pipes.length > 0 && pipes[0].x + pipeWidth < 0) {
        pipes.shift();
      }
    }

    function die() {
      gameState = 'dead';
      setIsDead(true);
      setHighScore(prev => {
        const next = Math.max(prev, currentScore);
        try { localStorage.setItem('cloudhopper_best', next.toString()); } catch { /* ignore */ }
        return next;
      });
    }

    function draw() {
      // Sky background
      ctx.fillStyle = '#bae6fd'; // soft blue
      ctx.fillRect(0, 0, w, h);

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(w * 0.2 + (frames * -0.5) % w, h * 0.8, 40, 0, Math.PI * 2);
      ctx.arc(w * 0.2 + 40 + (frames * -0.5) % w, h * 0.8, 50, 0, Math.PI * 2);
      ctx.arc(w * 0.2 + 80 + (frames * -0.5) % w, h * 0.8, 30, 0, Math.PI * 2);
      ctx.fill();

      // Pipes
      ctx.fillStyle = '#cbd5e1'; // soft grey/white pipes (pillars)
      pipes.forEach(p => {
        // Top
        ctx.fillRect(p.x, p.y, p.width, p.height);
        // Bottom
        ctx.fillRect(p.x, p.y + p.height + gap, p.width, h - (p.y + p.height + gap));
      });

      bird.draw();
    }

    let animationId: number;
    function loop() {
      update();
      draw();
      animationId = requestAnimationFrame(loop);
    }

    loop();

    const handleInput = (e: Event) => {
      e.preventDefault();
      flap();
    };
    
    canvas.addEventListener('touchstart', handleInput, { passive: false });
    canvas.addEventListener('mousedown', handleInput);
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', keydown);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', keydown);
      canvas.removeEventListener('touchstart', handleInput);
      canvas.removeEventListener('mousedown', handleInput);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#0d1117' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      
      <div style={{ position: 'absolute', top: 20, left: 20, color: '#0f172a', fontWeight: 800, fontSize: 24, textShadow: '0 2px 4px rgba(255,255,255,0.5)', pointerEvents: 'none' }}>
        {score}
      </div>
      <div style={{ position: 'absolute', top: 20, right: 20, color: 'rgba(15, 23, 42, 0.5)', fontWeight: 800, fontSize: 16, pointerEvents: 'none' }}>
        BEST: {highScore}
      </div>

      {!started && !isDead && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', pointerEvents: 'none' }}>
          <div style={{ color: '#0f172a', fontSize: 24, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', background: 'rgba(255,255,255,0.8)', padding: '12px 24px', borderRadius: 20 }}>
            Tap to Hop
          </div>
        </div>
      )}

      {isDead && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', pointerEvents: 'none' }}>
          <div style={{ color: '#fff', fontSize: 32, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', textShadow: '0 4px 12px rgba(0,0,0,0.5)', marginBottom: 16 }}>
            Oops!
          </div>
          <div style={{ color: '#fff', fontSize: 16, background: 'rgba(255,255,255,0.2)', padding: '8px 20px', borderRadius: 20, backdropFilter: 'blur(4px)' }}>
            Tap to try again
          </div>
        </div>
      )}
    </div>
  );
};
