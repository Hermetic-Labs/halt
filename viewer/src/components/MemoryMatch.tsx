import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const CARD_PAIRS = ['🐶', '🐱', '🐢', '🐸', '🐼', '🦊', '🐷', '🐨'];

export const MemoryMatch: React.FC = () => {
  const [cards, setCards] = useState<{ id: number; content: string }[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [matchedIndices, setMatchedIndices] = useState<number[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [moves, setMoves] = useState(0);

  const initializeGame = () => {
    const shuffled = [...CARD_PAIRS, ...CARD_PAIRS]
      .sort(() => Math.random() - 0.5)
      .map((content, index) => ({ content, id: index }));
    setCards(shuffled);
    setFlippedIndices([]);
    setMatchedIndices([]);
    setMoves(0);
    setDisabled(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initializeGame();
  }, []);

  const handleCardClick = (index: number) => {
    if (disabled || flippedIndices.includes(index) || matchedIndices.includes(index)) return;

    const newFlipped = [...flippedIndices, index];
    setFlippedIndices(newFlipped);

    if (newFlipped.length === 2) {
      setDisabled(true);
      setMoves((m) => m + 1);
      const [firstIndex, secondIndex] = newFlipped;
      
      if (cards[firstIndex].content === cards[secondIndex].content) {
        setMatchedIndices((prev) => [...prev, firstIndex, secondIndex]);
        setFlippedIndices([]);
        setDisabled(false);
      } else {
        setTimeout(() => {
          setFlippedIndices([]);
          setDisabled(false);
        }, 1000);
      }
    }
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0d1117',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative'
    }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '380px', marginBottom: 20 }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 700, letterSpacing: '1px' }}>
          MOVES: <span style={{ color: '#fff' }}>{moves}</span>
        </div>
        <button 
          onClick={initializeGame}
          style={{
            background: 'rgba(99, 102, 241, 0.2)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            color: '#c7d2fe',
            borderRadius: 12, padding: '4px 12px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '1px'
          }}
        >
          Restart
        </button>
      </div>

      <div style={{
        display: 'grid', 
        gridTemplateColumns: 'repeat(4, 1fr)', 
        gap: '12px', 
        width: '380px',
        perspective: '1000px'
      }}>
        {cards.map((card, index) => {
          const isFlipped = flippedIndices.includes(index) || matchedIndices.includes(index);
          const isMatched = matchedIndices.includes(index);

          return (
            <motion.div
              key={card.id}
              onClick={() => handleCardClick(index)}
              whileHover={{ scale: isFlipped ? 1 : 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{
                height: '85px',
                background: isMatched ? 'rgba(52, 211, 153, 0.2)' : isFlipped ? 'rgba(255,255,255,0.1)' : 'rgba(99, 102, 241, 0.15)',
                border: isMatched ? '2px solid rgba(52, 211, 153, 0.5)' : isFlipped ? '2px solid rgba(255,255,255,0.2)' : '2px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isFlipped ? 'default' : 'pointer',
                transformStyle: 'preserve-3d',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                backdropFilter: 'blur(4px)'
              }}
            >
              {/* Back of card (visible when rotateY is 0) */}
              <div style={{
                position: 'absolute',
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, opacity: isFlipped ? 0 : 1, transition: 'opacity 0.2s'
              }}>
                🌟
              </div>

              {/* Front of card (visible when rotateY is 180) */}
              <div style={{
                position: 'absolute',
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36,
                transform: 'rotateY(180deg)',
                opacity: isFlipped ? 1 : 0, transition: 'opacity 0.2s'
              }}>
                {card.content}
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {matchedIndices.length === cards.length && cards.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            style={{
              position: 'absolute',
              bottom: 40,
              background: 'rgba(52, 211, 153, 0.2)',
              border: '2px solid rgba(52, 211, 153, 0.5)',
              padding: '12px 24px',
              borderRadius: 20,
              color: '#fff',
              fontWeight: 800,
              letterSpacing: '2px',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 8px 32px rgba(52, 211, 153, 0.2)'
            }}
          >
            YOU DID IT! 🎉
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
