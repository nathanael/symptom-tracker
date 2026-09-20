import React from 'react';
import { getScoreColor } from '../utils/healthScore';
import './insights.css';

export default function HealthScoreCompact({ score, rollingAvg, delta, showOnGraph, onToggleGraph, inspectValue }) {
  const isInspecting = inspectValue !== undefined && inspectValue !== null;
  const displayValue = isInspecting ? inspectValue : (score !== null ? score : rollingAvg);
  if (displayValue === null) return null;

  const color = getScoreColor(displayValue);

  return (
    <div className={`is-score${showOnGraph ? ' on' : ''}`} onClick={onToggleGraph}>
      <span className="num" style={{ color }}>{displayValue}%</span>
      <div className="body">
        <div className="cap"><b>Health score</b></div>
        <div className="bar"><i style={{ width: `${displayValue}%`, background: color }} /></div>
      </div>
      {delta !== null && delta !== 0 && (
        <span className="delta" style={{ color: delta > 0 ? '#22c55e' : '#ef4444' }}>
          {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
        </span>
      )}
    </div>
  );
}
