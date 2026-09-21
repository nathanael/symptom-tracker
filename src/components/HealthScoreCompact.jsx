import React from 'react';
import { getScoreColor } from '../utils/healthScore';
import './insights.css';

export default function HealthScoreCompact({ score, rollingAvg, delta, deltaLabel, caption, showOnGraph, onToggleGraph, inspectValue }) {
  const isInspecting = inspectValue !== undefined && inspectValue !== null;
  const displayValue = isInspecting ? inspectValue : (score !== null ? score : rollingAvg);
  if (displayValue === null) return null;

  const color = getScoreColor(displayValue);

  return (
    <div className={`is-score${showOnGraph ? ' on' : ''}`} onClick={onToggleGraph}>
      <span className="num" style={{ color }}>{displayValue}%</span>
      <div className="body">
        <div className="cap"><b>Health score</b>{caption && <span>{caption}</span>}</div>
        <div className="bar"><i style={{ width: `${displayValue}%`, background: color }} /></div>
      </div>
      {/* Points against the previous window; hidden while a single day is being read off the chart */}
      {!isInspecting && delta !== null && delta !== undefined && delta !== 0 && (
        <span className={`delta ${delta > 0 ? 'good' : 'bad'}`}>
          {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
          {deltaLabel && <small>{deltaLabel}</small>}
        </span>
      )}
    </div>
  );
}
