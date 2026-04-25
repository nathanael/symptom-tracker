import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useGarminSleep } from '../hooks/useGarminSleep';
import {
  aggregate, rangeForPreset,
  computeCompareStats, defaultComparePeriods,
  previousPeriodOf, priorYearPeriodOf, alignByIndex,
} from '../utils/garminSleepCache';
import { METRICS, valueForRow } from '../utils/sleepMetrics';

const PRESETS = [
  { key: '7d',  label: '7D'  },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: '3mo', label: '3M'  },
  { key: '6mo', label: '6M'  },
  { key: '1y',  label: '1Y'  },
  { key: 'all', label: 'All' },
];

const MODES = [
  { key: 'days',   label: 'Days'   },
  { key: 'weeks',  label: 'Weeks'  },
  { key: 'months', label: 'Months' },
];

export default function SleepAnalyzer({ user, isDesktop }) {
  const { days, loading, error } = useGarminSleep(user);
  const [preset, setPreset] = useState('3mo');
  const [viewMode, setViewMode] = useState('weeks');
  const [activeMetric, setActiveMetric] = useState('sleepScore');
  const [compareMode, setCompareMode] = useState(false);
  const [compareType, setCompareType] = useState('previous');
  const [period1, setPeriod1] = useState({ start: '', end: '' });
  const [period2, setPeriod2] = useState({ start: '', end: '' });

  const availableMin = days.length ? days[0].date : null;
  const availableMax = days.length ? days[days.length - 1].date : null;

  useEffect(() => {
    if (days.length > 0 && !period2.end) {
      const { period1: p1, period2: p2 } = defaultComparePeriods(days);
      setPeriod1(p1);
      setPeriod2(p2);
    }
  }, [days, period2.end]);

  useEffect(() => {
    if (!period2.end) return;
    if (compareType === 'previous') setPeriod1(previousPeriodOf(period2));
    else if (compareType === 'year') setPeriod1(priorYearPeriodOf(period2));
    // 'custom' leaves period1 as-is
  }, [compareType, period2]);

  const visible = useMemo(() => {
    if (!days.length) return [];
    const range = rangeForPreset(preset, availableMin, availableMax);
    const sliced = days.filter(d => d.date >= range.start && d.date <= range.end);
    return aggregate(sliced, viewMode);
  }, [days, preset, viewMode, availableMin, availableMax]);

  const activeMetricDef = useMemo(
    () => METRICS.find(m => m.key === activeMetric),
    [activeMetric]
  );

  const chartData = useMemo(
    () => visible.map(row => ({
      date: row.date,
      value: valueForRow(activeMetricDef, row),
    })),
    [visible, activeMetricDef]
  );

  const compareRows = useMemo(() => {
    if (!compareMode || !days.length) return { rowsA: [], rowsB: [] };
    const rowsA = days.filter(d => d.date >= period1.start && d.date <= period1.end);
    const rowsB = days.filter(d => d.date >= period2.start && d.date <= period2.end);
    return { rowsA, rowsB };
  }, [compareMode, days, period1, period2]);

  const compareStats = useMemo(() => {
    if (!compareMode) return null;
    return computeCompareStats(
      compareRows.rowsA,
      compareRows.rowsB,
      r => valueForRow(activeMetricDef, r),
      activeMetricDef.higherIsBetter,
    );
  }, [compareMode, compareRows, activeMetricDef]);

  const alignedChartData = useMemo(() => {
    if (!compareMode) return null;
    return alignByIndex(
      compareRows.rowsA,
      compareRows.rowsB,
      r => valueForRow(activeMetricDef, r),
    );
  }, [compareMode, compareRows, activeMetricDef]);

  if (!user) {
    return <div style={styles.empty}>Sign in with Google in Settings to view Garmin sleep data.</div>;
  }
  if (loading && days.length === 0) {
    return <div style={styles.empty}>Loading…</div>;
  }
  if (error && days.length === 0) {
    return <div style={styles.empty}>Could not load sleep data. Check your connection.</div>;
  }
  if (days.length === 0) {
    return (
      <div style={styles.empty}>
        No sleep data synced yet. Run{' '}
        <code>sync.py &amp;&amp; push_to_firestore.py</code> on your Mac.
      </div>
    );
  }

  return (
    <div style={{ ...styles.root, ...styles.card }}>
      <div style={{ display: 'flex', marginBottom: 8 }}>
        <button
          onClick={() => setCompareMode(m => !m)}
          style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 13, border: 'none',
            cursor: 'pointer', color: compareMode ? '#fff' : '#9ca3af',
            background: compareMode ? '#3b82f6' : 'rgba(255,255,255,0.06)',
            fontWeight: 500,
          }}
        >
          Compare {compareMode ? 'on' : 'off'}
        </button>
        {compareMode && (
          <div style={{ display: 'flex', gap: 2, borderRadius: 8, background: 'rgba(255,255,255,0.06)', padding: 2, marginLeft: 8, flex: 1 }}>
            {['previous', 'year', 'custom'].map(t => {
              const active = compareType === t;
              return (
                <button key={t} onClick={() => setCompareType(t)} style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', flex: 1,
                  color: active ? '#fff' : '#9ca3af',
                  background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                }}>
                  {t === 'previous' ? 'Prev' : t === 'year' ? 'YoY' : 'Custom'}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {compareMode && compareType === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 2 }}>Period A</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="date" value={period1.start} min={availableMin} max={availableMax}
                     onChange={e => setPeriod1({ ...period1, start: e.target.value })}
                     style={styles.dateInputStyle} />
              <input type="date" value={period1.end} min={availableMin} max={availableMax}
                     onChange={e => setPeriod1({ ...period1, end: e.target.value })}
                     style={styles.dateInputStyle} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 2 }}>Period B</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="date" value={period2.start} min={availableMin} max={availableMax}
                     onChange={e => setPeriod2({ ...period2, start: e.target.value })}
                     style={styles.dateInputStyle} />
              <input type="date" value={period2.end} min={availableMin} max={availableMax}
                     onChange={e => setPeriod2({ ...period2, end: e.target.value })}
                     style={styles.dateInputStyle} />
            </div>
          </div>
        </div>
      )}
      <div style={{
        display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        gap: 4, borderRadius: 8, background: 'rgba(255,255,255,0.06)', padding: 2,
      }}>
        {METRICS.map(m => {
          const active = m.key === activeMetric;
          return (
            <button
              key={m.key}
              onClick={() => setActiveMetric(m.key)}
              style={{
                flex: '0 0 auto', minWidth: 64,
                padding: '6px 10px', fontSize: 13, borderRadius: 6,
                border: 'none', cursor: 'pointer',
                color: active ? '#fff' : '#9ca3af',
                background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                fontWeight: active ? 600 : 500,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div style={{ height: 8 }} />
      <SegmentedToggle options={PRESETS} value={preset} onChange={setPreset} />
      <div style={{ height: 8 }} />
      <SegmentedToggle options={MODES} value={viewMode} onChange={setViewMode} />
      {compareMode && compareStats && (
        <div style={{ marginTop: 12, marginBottom: 12, display: 'flex', gap: 12 }}>
          <PeriodStat label="Period A" period={period1} value={compareStats.avgA} unit={activeMetricDef.unit} better={compareStats.betterSide === 'a'} />
          <PeriodStat label="Period B" period={period2} value={compareStats.avgB} unit={activeMetricDef.unit} better={compareStats.betterSide === 'b'} />
          <div style={{ alignSelf: 'center', color: '#9ca3af', fontSize: 13 }}>
            {compareStats.pctChange != null
              ? `${compareStats.pctChange > 0 ? '+' : ''}${compareStats.pctChange.toFixed(1)}%`
              : '—'}
          </div>
        </div>
      )}
      <div style={styles.chartWrap}>
        <div style={styles.metricHeader}>
          {activeMetricDef.label}{activeMetricDef.unit && ` (${activeMetricDef.unit})`}
        </div>
        <ResponsiveContainer width="100%" height={isDesktop ? 360 : 280}>
          <LineChart data={compareMode ? alignedChartData : chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey={compareMode ? 'i' : 'date'}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
              minTickGap={24}
              tickFormatter={compareMode ? (v) => `Day ${Number(v) + 1}` : undefined}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,17,21,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#e5e7eb',
                fontSize: 12,
              }}
              labelStyle={{ color: '#9ca3af' }}
            />
            {(activeMetricDef.refs || []).map((ref, i) => (
              <ReferenceLine
                key={i}
                y={ref.y}
                stroke={ref.color}
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
            ))}
            {compareMode ? (
              <>
                <Line type="monotone" dataKey="aValue" name="Period A" stroke="#9ca3af" strokeWidth={2}
                      dot={{ r: 2, fill: '#9ca3af' }} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="bValue" name="Period B" stroke="#60a5fa" strokeWidth={2}
                      dot={{ r: 2.5, fill: '#60a5fa' }} connectNulls={false} isAnimationActive={false} />
              </>
            ) : (
              <Line
                type="monotone"
                dataKey="value"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ r: 2.5, fill: '#60a5fa' }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SegmentedToggle({ options, value, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 2, borderRadius: 8,
      background: 'rgba(255,255,255,0.06)', padding: 2,
    }}>
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '6px 0', fontSize: 13, borderRadius: 6,
              border: 'none', cursor: 'pointer', flex: 1,
              color: active ? '#fff' : '#9ca3af',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              fontWeight: active ? 600 : 500,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PeriodStat({ label, period, value, unit, better }) {
  return (
    <div style={{
      flex: 1,
      padding: 10,
      borderRadius: 8,
      background: better ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${better ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.1)'}`,
    }}>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: '#6b7280' }}>
        {period.start} → {period.end}
      </div>
      <div style={{ fontSize: 18, color: '#e5e7eb', fontWeight: 600, marginTop: 4 }}>
        {value != null ? Math.round(value) : '—'}{unit ? ` ${unit}` : ''}
      </div>
    </div>
  );
}

const styles = {
  root: { color: '#e5e7eb' },
  card: {
    background: 'rgba(15,17,21,0.6)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  empty: { color: '#9ca3af', padding: '24px', textAlign: 'center' },
  chartWrap: { marginTop: 16 },
  metricHeader: {
    fontSize: 13, fontWeight: 600, color: '#e5e7eb', marginBottom: 8,
  },
  dateInputStyle: {
    flex: 1, minWidth: 0,
    padding: '4px 6px', fontSize: 11,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#e5e7eb',
    colorScheme: 'dark',
  },
};
