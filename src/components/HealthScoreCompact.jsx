import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreCompact({ score, rollingAvg, delta, showOnGraph, onToggleGraph, rollingDays = 7, inspectValue, inspectLabel }) {
  const isInspecting = inspectValue !== undefined && inspectValue !== null;
  const displayValue = isInspecting ? inspectValue : (score !== null ? score : rollingAvg);
  if (displayValue === null) return null;

  const color = getScoreColor(displayValue);

  return (
    <div
      style={{
        background: '#111827',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 24, fontWeight: 700, color, flexShrink: 0, transition: 'color 0.15s ease' }}>
        {displayValue}%
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#888' }}>
            Health Score
          </span>
          <span style={{ fontSize: 10, color: isInspecting ? '#bbb' : '#888', transition: 'color 0.15s ease' }}>
            {isInspecting ? inspectLabel : `${rollingDays}d avg`}
          </span>
        </div>
        <div style={{ background: '#1f2937', borderRadius: 3, height: 5, overflow: 'hidden' }}>
          <div style={{
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            width: `${displayValue}%`,
            height: '100%',
            borderRadius: 3,
          }} />
        </div>
      </div>
      {delta !== null && delta !== 0 && (
        <span style={{ fontSize: 11, color: delta > 0 ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
          {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
        </span>
      )}
      {onToggleGraph && (
        <div
          onClick={(e) => { e.stopPropagation(); onToggleGraph(); }}
          style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
            border: `2px solid ${showOnGraph ? '#10b981' : '#555'}`,
            background: showOnGraph ? '#10b98130' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {showOnGraph && <span style={{ color: '#10b981', fontSize: 11, fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
        </div>
      )}
    </div>
  );
}
