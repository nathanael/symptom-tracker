import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreCard({ score, loggedCount, totalActive, rollingAvg, delta }) {
  const color = getScoreColor(score);
  const displayScore = score !== null ? `${score}%` : '—';
  const displayAvg = rollingAvg !== null ? `${rollingAvg}%` : '—';

  let deltaText = null;
  if (delta !== null && delta !== 0) {
    const improving = delta < 0;
    deltaText = (
      <span style={{ fontSize: 12, color: improving ? '#22c55e' : '#ef4444' }}>
        {improving ? '▼' : '▲'} {Math.abs(delta)}%
      </span>
    );
  }

  return (
    <div style={{
      background: '#111827',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888' }}>
            Health Score
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color }}>{displayScore}</span>
            {deltaText}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#888' }}>7-day avg</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
            {displayAvg}
          </div>
        </div>
      </div>
      {score !== null && (
        <div style={{ background: '#1f2937', borderRadius: 4, height: 6, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            width: `${score}%`,
            height: '100%',
            borderRadius: 4,
          }} />
        </div>
      )}
      <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
        {loggedCount} of {totalActive} symptoms logged
      </div>
    </div>
  );
}
