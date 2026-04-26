import React from 'react';
import { motion } from 'framer-motion';

export const CalmShapes: React.FC = () => {
  const shapes = [
    { id: 1, type: 'circle', color: 'rgba(244, 114, 182, 0.6)', size: 80, startX: -100, startY: -100 },
    { id: 2, type: 'square', color: 'rgba(96, 165, 250, 0.6)', size: 90, startX: 100, startY: -50 },
    { id: 3, type: 'circle', color: 'rgba(52, 211, 153, 0.6)', size: 110, startX: -50, startY: 100 },
    { id: 4, type: 'square', color: 'rgba(167, 139, 250, 0.6)', size: 70, startX: 120, startY: 80 },
    { id: 5, type: 'circle', color: 'rgba(251, 191, 36, 0.6)', size: 60, startX: 0, startY: 0 },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0d1117',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        position: 'absolute', top: 30, left: 0, right: 0,
        textAlign: 'center', color: 'rgba(255,255,255,0.4)',
        fontSize: 14, letterSpacing: '2px', textTransform: 'uppercase',
        pointerEvents: 'none'
      }}>
        Drag the shapes around
      </div>

      {shapes.map((s) => (
        <motion.div
          key={s.id}
          drag
          dragConstraints={{ left: -300, right: 300, top: -200, bottom: 200 }}
          dragElastic={0.1}
          whileHover={{ scale: 1.05 }}
          whileDrag={{ scale: 1.15, cursor: 'grabbing', zIndex: 10 }}
          initial={{ x: s.startX, y: s.startY, opacity: 0, scale: 0 }}
          animate={{ x: s.startX, y: s.startY, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 100, delay: s.id * 0.1 }}
          style={{
            position: 'absolute',
            width: s.size,
            height: s.size,
            background: s.color,
            borderRadius: s.type === 'circle' ? '50%' : '16px',
            backdropFilter: 'blur(8px)',
            border: '2px solid rgba(255,255,255,0.2)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        />
      ))}
    </div>
  );
};
