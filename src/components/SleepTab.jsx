import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
import './desktopNav.css';
import './sleepTab.css';
import { aggregate, rangeForPreset, previousPeriodOf, priorYearPeriodOf, alignByIndex } from '../utils/garminSleepCache';
import { computeHealthScore } from '../utils/healthScore';
import {
  CONTRIBUTORS, contributorStanding, sleepBalance, scoreVerdict, asleepMinutes,
  symptomLinks, supplementLinks, pearson, mean, shiftDate,
} from '../utils/sleepInsights';

const PRESETS = ['7d', '14d', '30d', '3mo', '1y', 'all'];
const MODES = [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months']];
const TIP = { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 };
const AXIS = { fill: '#6b7280', fontSize: 11 };
const hm = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`);
const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const LS_BASIS = 'sleepRingBasis';

function readBasis() {
  try { return localStorage.getItem(LS_BASIS) === 'targets' ? 'targets' : 'baseline'; } catch { return 'baseline'; }
}

const plain = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const mins = (sec) => (sec != null ? sec / 60 : null);

// Stat tiles, copied from the Garmin dashboard: title, averaged value, chart colour and guideline
const TILES = [
  { key: 'score', title: 'Sleep Score', chart: 'Sleep Score', get: (d) => d.sleepScore ?? null, dec: 0, unit: '', up: true, color: '#10b981', ref: 80 },
  { key: 'duration', title: 'Duration', chart: 'Duration', get: (d) => { const m = asleepMinutes(d); return m != null ? m / 60 : null; }, dec: 1, unit: ' hrs', up: true, color: '#6ee7b7', ref: 8 },
  { key: 'rem', title: 'REM Sleep', chart: 'REM Sleep', get: (d) => mins(d.remSleepSeconds), dec: 1, unit: ' min', up: true, color: '#8b5cf6', ref: 90 },
  { key: 'deep', title: 'Deep Sleep', chart: 'Deep Sleep', get: (d) => mins(d.deepSleepSeconds), dec: 1, unit: ' min', up: true, color: '#3b82f6', ref: 60 },
  { key: 'respiration', title: 'Respiration', chart: 'Respiration Rate', get: (d) => d.averageRespiration ?? null, dec: 1, unit: ' brpm', up: false, color: '#f59e0b', ref: 14 },
  { key: 'spo2', title: 'SpO2 Low', chart: 'SpO2 (Lowest)', get: (d) => d.lowestSpo2 ?? null, dec: 1, unit: '%', up: true, color: '#06b6d4', ref: 92 },
  { key: 'stress', title: 'Stress', chart: 'Sleep Stress', get: (d) => d.avgSleepStress ?? null, dec: 1, unit: '', up: false, color: '#ef4444', ref: 20 },
  { key: 'hrv', title: 'HRV', chart: 'HRV (Overnight)', get: (d) => d.hrvOvernight ?? null, dec: 0, unit: ' ms', up: true, color: '#a78bfa', ref: null },
  { key: 'bodyBattery', title: 'Body Battery', chart: 'Body Battery', get: (d) => d.bodyBatteryHigh ?? null, dec: 0, unit: '', up: true, color: '#22c55e', ref: 75 },
];
const tileValue = (t, v) => (v == null ? '-' : `${v.toFixed(t.dec)}${t.unit}`);
const chartValue = (t, d) => { const v = t.get(d); return v == null ? null : +v.toFixed(1); };
const unitOf = (t) => t.unit.trim();

function Donut({ size, stroke, pct, color, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="sl-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export default function SleepTab({ days, symptoms, entries, stackItems, stackEntries, trackingMode, barSlot }) {
  const [night, setNight] = useState(0); // 0 = newest night
  const [preset, setPreset] = useState('14d');
  const [mode, setMode] = useState('days');
  const [basis, setBasis] = useState(readBasis);
  const [active, setActive] = useState('score');
  const [overlay, setOverlay] = useState(true);
  const [compareTo, setCompareTo] = useState('previous');
  const [drag, setDrag] = useState(null); // { a, b } dates while selecting
  const [selection, setSelection] = useState(null);

  const chooseBasis = (b) => { setBasis(b); try { localStorage.setItem(LS_BASIS, b); } catch { /* non-fatal */ } };
  const metric = TILES.find((t) => t.key === active) || TILES[0];

  const minDate = days[0]?.date, maxDate = days[days.length - 1]?.date;
  const nightIdx = Math.max(0, days.length - 1 - night);
  const row = days[nightIdx] || {};

  // Window + the equal-length period before it
  const { visible, prior, range } = useMemo(() => {
    if (!days.length) return { visible: [], prior: [], range: null };
    const r = rangeForPreset(preset, minDate, maxDate);
    const p = previousPeriodOf(r);
    return {
      range: r,
      visible: days.filter((d) => d.date >= r.start && d.date <= r.end),
      prior: days.filter((d) => d.date >= p.start && d.date <= p.end),
    };
  }, [days, preset, minDate, maxDate]);

  const healthByDate = useMemo(() => {
    const map = new Map();
    for (const d of days) {
      const { score } = computeHealthScore(symptoms, entries, d.date, trackingMode);
      if (score != null) map.set(d.date, score);
    }
    return map;
  }, [days, symptoms, entries, trackingMode]);

  // Chart rows (aggregated for weeks/months), with a 7-point rolling average
  const chartRows = useMemo(() => {
    const rows = aggregate(visible, mode).map((d) => ({
      date: d.date,
      value: chartValue(metric, d),
      health: mode === 'days' ? healthByDate.get(d.date) ?? null : (() => {
        const vals = visible.filter((v) => (mode === 'weeks' ? v.date >= d.date && v.date < shiftDate(d.date, 7) : v.date.startsWith(d.date))).map((v) => healthByDate.get(v.date)).filter((x) => x != null);
        return vals.length ? Math.round(mean(vals)) : null;
      })(),
    }));
    return rows.map((r, i) => {
      const win = rows.slice(Math.max(0, i - 6), i + 1).map((x) => x.value).filter((v) => v != null);
      return { ...r, rolling: win.length ? +mean(win).toFixed(1) : null };
    });
  }, [visible, mode, metric, healthByDate]);

  const stageRows = useMemo(() => aggregate(visible, mode).map((d) => ({
    date: d.date,
    Deep: d.deepSleepSeconds != null ? Math.round(d.deepSleepSeconds / 60) : null,
    REM: d.remSleepSeconds != null ? Math.round(d.remSleepSeconds / 60) : null,
    Light: d.lightSleepSeconds != null ? Math.round(d.lightSleepSeconds / 60) : null,
    Awake: d.awakeSleepSeconds != null ? Math.round(d.awakeSleepSeconds / 60) : null,
  })), [visible, mode]);

  const compare = useMemo(() => {
    if (!range) return null;
    const p = compareTo === 'year' ? priorYearPeriodOf(range) : previousPeriodOf(range);
    const a = days.filter((d) => d.date >= p.start && d.date <= p.end);
    const fn = (d) => chartValue(metric, d);
    const avgOf = (rows) => { const v = rows.map(fn).filter((x) => x != null); return v.length ? mean(v) : null; };
    return { p, rows: alignByIndex(a, visible, fn).map((x) => ({ ...x, n: x.i + 1 })), aAvg: avgOf(a), bAvg: avgOf(visible), hasA: a.length > 0 };
  }, [days, visible, range, compareTo, metric]);

  // Last 90 nights drive the symptom links
  const links = useMemo(() => {
    const recent = days.slice(-90);
    const sym = symptomLinks(recent, symptoms, entries, trackingMode);
    const sup = supplementLinks(recent, stackItems, stackEntries);
    const pairs = recent.filter((d) => d.sleepScore != null && healthByDate.has(d.date));
    const r = pairs.length >= 10 ? pearson(pairs.map((d) => d.sleepScore), pairs.map((d) => healthByDate.get(d.date))) : null;
    return { sym, sup, r, rN: pairs.length, nights: recent.length };
  }, [days, symptoms, entries, trackingMode, stackItems, stackEntries, healthByDate]);

  const balance = useMemo(() => sleepBalance(days.slice(Math.max(0, nightIdx - 13), nightIdx + 1)), [days, nightIdx]);
  const baselineRows = days.slice(Math.max(0, nightIdx - 30), nightIdx);
  const verdict = scoreVerdict(row.sleepScore);
  const asleep = asleepMinutes(row);

  const endDrag = () => {
    if (drag && drag.a && drag.b && drag.a !== drag.b) {
      const [s, e] = [drag.a, drag.b].sort();
      const vals = chartRows.filter((r) => r.date >= s && r.date <= e).map((r) => r.value).filter((v) => v != null);
      setSelection(vals.length ? { s, e, n: vals.length, avg: mean(vals), min: Math.min(...vals), max: Math.max(...vals) } : null);
    }
    setDrag(null);
  };

  const bar = barSlot && createPortal(
    <>
      <div className="dn-step">
        <button aria-label="Previous night" disabled={nightIdx === 0} onClick={() => setNight((n) => n + 1)}><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
        <button className="dn-date" title="Back to the newest night" onClick={() => setNight(0)}>
          {night === 0 ? 'Last night' : shortDate(row.date)}
          {row.date && <small>{shortDate(shiftDate(row.date, -1))} → {shortDate(row.date)}</small>}
        </button>
        <button aria-label="Next night" disabled={night === 0} onClick={() => setNight((n) => Math.max(0, n - 1))}><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg></button>
      </div>
      <span className="lr-spacer" />
      <div className="dn-seg sm">{PRESETS.map((p) => <button key={p} className={preset === p ? 'on' : ''} onClick={() => { setPreset(p); setSelection(null); }}>{p === 'all' ? 'All' : p}</button>)}</div>
      <div className="dn-seg sm">{MODES.map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setSelection(null); }}>{l}</button>)}</div>
    </>,
    barSlot,
  );

  if (!days.length) {
    return <>{bar}<div className="sl-empty">No Garmin nights synced yet.</div></>;
  }

  const hasLinks = links.sym.length || links.sup.length || links.r != null;

  return (
    <div className="sl">
      {bar}
      <div className="sl-row1">
        <section className="sl-card">
          <div className="sl-hero">
            <Donut size={112} stroke={11} pct={(row.sleepScore || 0) / 100} color={verdict.color}><b className="sl-big">{row.sleepScore ?? '—'}</b></Donut>
            <div>
              <div className="sl-label">Sleep score</div>
              <div className="sl-verdict" style={{ color: verdict.color }}>{verdict.label}</div>
              <div className="sl-sub">{hm(asleep)} asleep · {hm(row.awakeSleepSeconds != null ? row.awakeSleepSeconds / 60 : null)} awake</div>
              {row.sleepNeedMinutes && <div className="sl-sub">Need {hm(row.sleepNeedMinutes)}</div>}
            </div>
            <div className="sl-balance">
              <div className="sl-label">Balance · last {balance.nights.length} nights</div>
              {balance.counted ? (
                <div className="sl-debt" style={{ color: balance.net <= 0 ? '#4ade80' : balance.net < 120 ? '#d1d5db' : balance.net < 300 ? '#fbbf24' : '#f87171' }}>
                  {hm(Math.abs(balance.net))}<span>{balance.net <= 0 ? 'ahead' : 'short'}</span>
                </div>
              ) : <div className="sl-sub">No sleep need recorded</div>}
              <div className="sl-strip">
                {balance.nights.map((n) => (
                  <i key={n.date} title={n.ratio == null ? `${n.date}: no data` : `${n.date}: ${hm(n.got)} of ${hm(n.need)}`}
                    style={{ background: n.ratio == null ? 'rgba(255,255,255,.08)' : n.ratio >= 1 ? '#22c55e' : n.ratio >= 0.88 ? '#eab308' : '#ef4444' }} />
                ))}
              </div>
            </div>
          </div>
          <div className="sl-contrib-head">
            <span className="sl-label">Contributors</span>
            <div className="dn-seg sm" title="Baseline: against your previous 30 nights · Targets: fixed guidelines">
              <button className={basis === 'baseline' ? 'on' : ''} onClick={() => chooseBasis('baseline')}>vs my baseline</button>
              <button className={basis === 'targets' ? 'on' : ''} onClick={() => chooseBasis('targets')}>vs targets</button>
            </div>
          </div>
          <div className="sl-rings">
            {CONTRIBUTORS.map((c) => {
              const st = contributorStanding(c, row, baselineRows, basis);
              return (
                <div key={c.key} className="sl-ring" title={st ? st.tip : 'No data for this night'}>
                  <Donut size={54} stroke={6} pct={st ? st.pct : 0} color={st ? st.color : '#374151'} />
                  <b>{st ? c.fmt(st.value) : '—'}</b>
                  <span>{c.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="sl-card">
          <div className="sl-head">
            <h2>Sleep and your symptoms</h2>
            <span className="sl-sub sl-push">last {links.nights} nights</span>
          </div>
          {hasLinks ? (
            <div className="sl-links">
              {links.sym.map((f) => (
                <div key={f.symptom} className="sl-link">
                  <p>{f.below ? 'Under' : 'Over'} <b>{f.threshold}{f.unit === 'min' ? ' min' : f.unit} {f.metric}</b> → <b>{f.symptom}</b> that day</p>
                  <span className="sl-n">{f.nights} nights · avg {f.badAvg.toFixed(1)} vs {f.restAvg.toFixed(1)}</span>
                  <span className="sl-effect bad">+{f.effect.toFixed(1)}</span>
                </div>
              ))}
              {links.sup.map((f) => (
                <div key={f.item} className="sl-link">
                  <p><b>{f.item}</b> taken → <b>{f.metric}</b> that night</p>
                  <span className="sl-n">{f.nights} of {f.total} nights · {Math.round(f.takenAvg)} vs {Math.round(f.skippedAvg)}{f.unit === 'min' ? ' min' : f.unit ? ` ${f.unit}` : ''}</span>
                  <span className={`sl-effect ${f.diff > 0 ? 'good' : 'bad'}`}>{f.diff > 0 ? '+' : '−'}{Math.abs(Math.round(f.diff))}{f.unit === 'min' ? 'm' : ''}</span>
                </div>
              ))}
              {links.r != null && (
                <div className="sl-link">
                  <p>Sleep score vs same-day <b>Health score</b></p>
                  <span className="sl-n">{Math.abs(links.r) >= 0.5 ? 'strong' : Math.abs(links.r) >= 0.3 ? 'moderate' : 'weak'} link · {links.rN} days</span>
                  <span className={`sl-effect ${links.r > 0 ? 'good' : 'bad'}`}>r {links.r.toFixed(2).replace(/^(-?)0/, '$1')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="sl-sub">Not enough overlap between sleep and symptom logs yet. Links show once there are at least 10 nights with symptoms logged the next day.</div>
          )}
          <div className="sl-foot">Bad nights are the worst third for each measure. Symptom scale 0–5; higher is worse.</div>
        </section>
      </div>

      <section className="sl-card sl-tiles">
        <div className="sl-kpis">
          {TILES.map((t) => {
            const cur = mean(visible.map(t.get).filter((v) => v != null));
            const prev = mean(prior.map(t.get).filter((v) => v != null));
            const pc = cur != null && prev ? ((cur - prev) / prev) * 100 : null;
            const tone = pc == null || Math.abs(pc) < 1 ? 'flat' : (pc > 0) === t.up ? 'good' : 'bad';
            const on = active === t.key;
            return (
              <button key={t.key} className={`sl-kpi ${on ? 'on' : ''}`} style={on ? { borderColor: t.color } : undefined} onClick={() => { setActive(t.key); setSelection(null); }}>
                <span className="sl-kpi-t"><span>{t.title}</span>{pc != null && Math.abs(pc) >= 1 && <span className={tone}>{pc > 0 ? '↗' : '↘'} {Math.abs(pc).toFixed(0)}%</span>}</span>
                <span className="sl-kpi-v">{tileValue(t, cur)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="sl-card">
        <div className="sl-head">
          <h2 className="sl-trend-title">{metric.chart} Trend</h2>
          <span className="sl-sub">{range && `${shortDate(range.start)} – ${shortDate(range.end)} · ${visible.length} nights · ${mode === 'days' ? 'daily' : mode === 'weeks' ? 'weekly' : 'monthly'}`}</span>
          <button className={`dn-btn sl-push ${overlay ? 'sl-on' : ''}`} onClick={() => setOverlay((o) => !o)}>Overlay Health score</button>
        </div>
        <div className="sl-chart" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
              onMouseDown={(e) => e?.activeLabel && setDrag({ a: e.activeLabel, b: e.activeLabel })}
              onMouseMove={(e) => drag && e?.activeLabel && setDrag((d) => ({ ...d, b: e.activeLabel }))}
              onMouseUp={endDrag} onMouseLeave={() => drag && endDrag()}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickFormatter={(d) => (mode === 'months' ? d : d.slice(5))} stroke="rgba(255,255,255,.1)" minTickGap={12} />
              <YAxis yAxisId="m" tick={AXIS} stroke="rgba(255,255,255,.1)" />
              {overlay && <YAxis yAxisId="h" orientation="right" domain={[0, 100]} tick={{ ...AXIS, fill: '#22d3ee' }} stroke="rgba(255,255,255,.1)" />}
              <Tooltip contentStyle={TIP} labelStyle={{ color: '#9ca3af' }} cursor={{ fill: 'rgba(255,255,255,.04)' }}
                formatter={(v, name) => [v, name === 'value' ? `${metric.chart}${unitOf(metric) ? ` (${unitOf(metric)})` : ''}` : name === 'rolling' ? '7-point avg' : 'Health score']} />
              {metric.ref != null && <ReferenceLine yAxisId="m" y={metric.ref} stroke="#6b7280" strokeDasharray="5 5" />}
              <Bar yAxisId="m" dataKey="value" fill={metric.color} fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="m" dataKey="rolling" stroke="rgba(255,255,255,.75)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
              {overlay && <Line yAxisId="h" dataKey="health" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2.5, fill: '#22d3ee' }} isAnimationActive={false} connectNulls />}
              {drag && drag.a !== drag.b && <ReferenceArea yAxisId="m" x1={drag.a} x2={drag.b} fill="rgba(139,92,246,.15)" />}
              {selection && !drag && <ReferenceArea yAxisId="m" x1={selection.s} x2={selection.e} fill="rgba(139,92,246,.12)" stroke="rgba(139,92,246,.5)" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="sl-legend">
          <span><i style={{ background: metric.color }} />{mode === 'days' ? 'Night' : mode === 'weeks' ? 'Week avg' : 'Month avg'}</span>
          <span><i style={{ background: 'rgba(255,255,255,.75)' }} />7-point average</span>
          {overlay && <span><i style={{ background: '#22d3ee' }} />Glimpse Health score (right axis)</span>}
        </div>
        <div className="sl-hint">
          {selection
            ? <>{shortDate(selection.s)} – {shortDate(selection.e)} · {selection.n} points · avg <b>{plain(+selection.avg.toFixed(1))}</b> · min {plain(selection.min)} · max {plain(selection.max)} <button className="sl-clear" onClick={() => setSelection(null)}>Clear</button></>
            : 'Drag across the chart to summarise a stretch of nights'}
        </div>
      </section>

      <div className="sl-row3">
        <section className="sl-card">
          <div className="sl-head"><h2>Stages</h2><span className="sl-sub">minutes per {mode === 'days' ? 'night' : 'night, averaged'}</span></div>
          <div className="sl-chart" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickFormatter={(d) => (mode === 'months' ? d : d.slice(5))} stroke="rgba(255,255,255,.1)" minTickGap={12} />
                <YAxis tick={AXIS} stroke="rgba(255,255,255,.1)" />
                <Tooltip contentStyle={TIP} labelStyle={{ color: '#9ca3af' }} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="Deep" stackId="s" fill="#6d28d9" isAnimationActive={false} />
                <Bar dataKey="REM" stackId="s" fill="#a78bfa" isAnimationActive={false} />
                <Bar dataKey="Light" stackId="s" fill="#3f3f55" isAnimationActive={false} />
                <Bar dataKey="Awake" stackId="s" fill="#b45309" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="sl-legend">
            <span><i style={{ background: '#6d28d9' }} />Deep</span><span><i style={{ background: '#a78bfa' }} />REM</span>
            <span><i style={{ background: '#3f3f55' }} />Light</span><span><i style={{ background: '#b45309' }} />Awake</span>
          </div>
        </section>

        <section className="sl-card">
          <div className="sl-head">
            <h2>Compare</h2>
            <span className="sl-sub">{metric.chart} by night</span>
            <div className="dn-seg sm sl-push">
              <button className={compareTo === 'previous' ? 'on' : ''} onClick={() => setCompareTo('previous')}>Previous period</button>
              <button className={compareTo === 'year' ? 'on' : ''} onClick={() => setCompareTo('year')}>A year ago</button>
            </div>
          </div>
          {compare?.hasA ? (
            <>
              <div className="sl-chart" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={compare.rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                    <XAxis dataKey="n" tick={AXIS} stroke="rgba(255,255,255,.1)" minTickGap={8} />
                    <YAxis tick={AXIS} stroke="rgba(255,255,255,.1)" />
                    <Tooltip contentStyle={TIP} labelStyle={{ color: '#9ca3af' }} labelFormatter={(n) => `Night ${n}`}
                      formatter={(v, name) => [v, name === 'aValue' ? 'Then' : 'Now']} />
                    <Line dataKey="aValue" stroke="#6b7280" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    <Line dataKey="bValue" stroke={metric.color} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="sl-legend">
                <span><i style={{ background: '#6b7280' }} />{shortDate(compare.p.start)} – {shortDate(compare.p.end)} · avg {plain(compare.aAvg != null ? +compare.aAvg.toFixed(1) : null)}</span>
                <span><i style={{ background: metric.color }} />{shortDate(range.start)} – {shortDate(range.end)} · avg {plain(compare.bAvg != null ? +compare.bAvg.toFixed(1) : null)}</span>
              </div>
            </>
          ) : <div className="sl-sub" style={{ padding: '24px 0' }}>No synced nights in that earlier period.</div>}
        </section>
      </div>
    </div>
  );
}
