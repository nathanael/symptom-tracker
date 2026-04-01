import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreCard({ score, loggedCount, totalActive, rollingAvg, delta }) {
  const displayValue = score !== null ? score : rollingAvg;
  if (displayValue === null) return null;

  const color = getScoreColor(displayValue);
  const isUsingAvg = score === null;

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
            <span style={{ fontSize: 32, fontWeight: 700, color }}>{displayValue}%</span>
            {!isUsingAvg && delta !== null && delta !== 0 && (
              <span style={{ fontSize: 12, color: delta > 0 ? '#22c55e' : '#ef4444' }}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}%
              </span>
            )}
          </div>
        </div>
        {!isUsingAvg && rollingAvg !== null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#888' }}>7-day avg</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
              {rollingAvg}%
            </div>
          </div>
        )}
        {isUsingAvg && (
          <div style={{ fontSize: 11, color: '#666' }}>7-day avg</div>
        )}
      </div>
      <div style={{ background: '#1f2937', borderRadius: 4, height: 6, marginTop: 10, overflow: 'hidden' }}>
        <div style={{
          background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          width: `${displayValue}%`,
          height: '100%',
          borderRadius: 4,
        }} />
      </div>
    </div>
  );
}
