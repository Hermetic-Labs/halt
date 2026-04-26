import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';

export const BreathingBubble: React.FC = () => {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    let timeout: number;
    
    if (phase === 'in') {
      timeout = window.setTimeout(() => setPhase('hold'), 4000); // 4s breathe in
    } else if (phase === 'hold') {
      timeout = window.setTimeout(() => setPhase('out'), 4000); // 4s hold
    } else if (phase === 'out') {
      timeout = window.setTimeout(() => setPhase('in'), 6000); // 6s breathe out
    }

    return () => clearTimeout(timeout);
  }, [phase]);

  const getInstructions = () => {
    switch (phase) {
      case 'in': return 'Breathe In...';
      case 'hold': return 'Hold...';
      case 'out': return 'Breathe Out...';
    }
  };

  const bubbleVariants: Variants = {
    in: { scale: 1.8, backgroundColor: 'rgba(129, 140, 248, 0.4)', transition: { duration: 4, ease: 'easeInOut' } },
    hold: { scale: 1.8, backgroundColor: 'rgba(167, 139, 250, 0.4)', transition: { duration: 4, ease: 'linear' } },
    out: { scale: 1, backgroundColor: 'rgba(96, 165, 250, 0.4)', transition: { duration: 6, ease: 'easeInOut' } }
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0d1117',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      
      {/* Background ambient pulse */}
      <motion.div
        animate={phase}
        variants={{
          in: { opacity: 0.3, transition: { duration: 4 } },
          hold: { opacity: 0.3, transition: { duration: 4 } },
          out: { opacity: 0.1, transition: { duration: 6 } }
        }}
        style={{
          position: 'absolute', width: '150vmax', height: '150vmax',
          background: 'radial-gradient(circle, rgba(167, 139, 250, 0.15) 0%, rgba(0,0,0,0) 60%)',
          borderRadius: '50%',
          zIndex: 0
        }}
      />

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        <div style={{ position: 'relative', width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* The expanding/contracting bubble */}
          <motion.div
            initial="out"
            animate={phase}
            variants={bubbleVariants}
            style={{
              position: 'absolute',
              width: 120, height: 120,
              borderRadius: '50%',
              boxShadow: '0 0 40px rgba(167, 139, 250, 0.4)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(4px)'
            }}
          />
          
          {/* Center anchor point */}
          <div style={{
            width: 16, height: 16,
            background: 'rgba(255, 255, 255, 0.8)',
            borderRadius: '50%',
            boxShadow: '0 0 10px rgba(255,255,255,0.5)'
          }} />
        </div>

        <div style={{ height: 60, marginTop: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5 }}
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: '#e2e8f0',
                letterSpacing: '2px',
                textShadow: '0 2px 10px rgba(0,0,0,0.5)'
              }}
            >
              {getInstructions()}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
};
