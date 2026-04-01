import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreBadge({ score, delta }) {
  if (score === null) return null;
  const color = getScoreColor(score);
  const displayScore = `${score}%`;

  let arrow = null;
  if (delta !== null && delta !== 0) {
    arrow = delta < 0
      ? <span style={{ color: '#22c55e', fontSize: '10px', marginLeft: 3 }}>▼{Math.abs(delta)}</span>
      : <span style={{ color: '#ef4444', fontSize: '10px', marginLeft: 3 }}>▲{Math.abs(delta)}</span>;
  }

  return (
    <div style={{
      background: `${color}18`,
      border: `1px solid ${color}55`,
      borderRadius: 16,
      padding: '3px 10px',
      fontSize: 12,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
    }}>
      <span style={{ color }}>{displayScore}</span>
      {arrow}
    </div>
  );
}
