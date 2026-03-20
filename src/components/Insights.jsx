import { useMemo, useState } from 'react';
import { getInsights, getSupplementAdherence, haptic } from '../utils/helpers';
import ComparisonStudio from './ComparisonStudio';

// Simple SVG sparkline component with moving average smoothing
const Sparkline = ({ data, color, width = 280, height = 60 }) => {
  if (!data || data.length < 2) return null;

  const maxSeverity = 5;
  const padding = 2; // Padding for stroke width
  const windowSize = Math.min(5, Math.ceil(data.length / 6));

  // Calculate moving average
  const smoothed = data.map((d, i) => {
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    const slice = data.slice(start, end);
    const avg = slice.reduce((sum, p) => sum + p.severity, 0) / slice.length;
    return avg;
  });

  const drawHeight = height - padding * 2;
  const points = smoothed.map((severity, i) => {
    const x = (i / (smoothed.length - 1)) * width;
    const y = padding + drawHeight - (severity / maxSeverity) * drawHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
};

export default function Insights({
  entries,
  symptoms,
  stackItems,
  stackEntries,
  insightsWindow,
  setInsightsWindow,
  onOpenGraph,
  onOpenSupplementGraph,
  isDesktop,
  trackingMode,
  insightsSubtab: insightsSubtabProp,
  setInsightsSubtab: setInsightsSubtabProp,
  setStackItems,
}) {
  const [expandedId, setExpandedId] = useState(null);
  // Desktop manages its own local subtab state; mobile gets it from App via BottomNav
  const [localSubtab, setLocalSubtab] = useState('studio');
  const insightsSubtab = insightsSubtabProp || localSubtab;
  const setInsightsSubtab = setInsightsSubtabProp || setLocalSubtab;

  const data = useMemo(() =>
    getInsights(insightsWindow, entries, symptoms),
    [insightsWindow, entries, symptoms]
  );

  const handleCardClick = (symptomId) => {
    haptic('light');
    setExpandedId(expandedId === symptomId ? null : symptomId);
  };

  return (
    <div
      style={isDesktop ? {
        // Desktop: inline, no fixed positioning
      } : {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#08090A',
        zIndex: 100,
        overflowY: 'auto',
        padding: '20px 20px 120px 20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      <div style={{ maxWidth: isDesktop ? '100%' : '700px', margin: '0 auto' }}>
        {/* Subtab toggle — desktop only (mobile uses BottomNav) */}
        {isDesktop && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px',
            padding: '4px',
            marginBottom: '24px',
            borderRadius: '12px',
            background: 'rgba(23, 23, 23, 0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            {[
              { id: 'studio', label: 'Comparison Studio' },
              { id: 'quick', label: 'Quick Insights' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setInsightsSubtab(tab.id); haptic('light'); }}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: insightsSubtab === tab.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                  boxShadow: insightsSubtab === tab.id ? '0 1px 2px rgba(0,0,0,0.05), inset 0 0 0 1px rgba(255,255,255,0.05)' : 'none',
                  color: insightsSubtab === tab.id ? '#fff' : '#a3a3a3',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {insightsSubtab === 'studio' ? (
          <ComparisonStudio
            entries={entries}
            symptoms={symptoms}
            stackItems={stackItems}
            stackEntries={stackEntries}
            trackingMode={trackingMode}
            isDesktop={isDesktop}
            setStackItems={setStackItems}
          />
        ) : (
        <>
        {/* Window Selector */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
          padding: '4px',
          marginBottom: '32px',
          borderRadius: '12px',
          background: 'rgba(23, 23, 23, 0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {[30, 60, 90].map((days) => (
            <button
              key={days}
              onClick={() => setInsightsWindow(days)}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: 'none',
                background: insightsWindow === days
                  ? 'rgba(255,255,255,0.1)'
                  : 'transparent',
                boxShadow: insightsWindow === days
                  ? '0 1px 2px rgba(0,0,0,0.05), inset 0 0 0 1px rgba(255,255,255,0.05)'
                  : 'none',
                color: insightsWindow === days ? '#fff' : '#a3a3a3',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              {days} days
            </button>
          ))}
        </div>

        {!data.hasEnoughData ? (
          <div style={{
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '5px',
            padding: '32px 24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>📊</div>
            <p style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '600', margin: '0 0 8px 0' }}>
              Keep tracking
            </p>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
              {data.daysOfData < data.minDaysNeeded
                ? `${data.minDaysNeeded - data.daysOfData} more days needed for ${insightsWindow}-day insights`
                : `${20 - data.entriesCount} more entries needed`
              }
            </p>
          </div>
        ) : data.insights.length === 0 && !data.topCluster ? (
          <div style={{
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '5px',
            padding: '32px 24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>📈</div>
            <p style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '600', margin: '0 0 8px 0' }}>
              No major changes
            </p>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
              Your symptoms have been relatively stable over the past {insightsWindow} days.
            </p>
          </div>
        ) : (
          <div style={isDesktop ? {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '32px',
            alignItems: 'start',
          } : {}}>
            {/* Left column (or full width on mobile): Symptom insights */}
            <div>
            {/* Insights tiles */}
            {data.insights.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
                {data.insights.map(insight => {
                  const isExpanded = expandedId === insight.symptomId;
                  const lineColor = insight.direction === 'improving' ? '#34d399' : '#fb7185';
                  const textColor = insight.direction === 'improving' ? 'rgba(209, 250, 229, 0.8)' : 'rgba(255, 228, 230, 0.8)';
                  const mutedColor = insight.direction === 'improving' ? 'rgba(110, 231, 183, 0.6)' : 'rgba(251, 113, 133, 0.6)';
                  const dimColor = insight.direction === 'improving' ? 'rgba(110, 231, 183, 0.5)' : 'rgba(251, 113, 133, 0.5)';

                  // Format date for display
                  const formatShortDate = (dateStr) => {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  };

                  return (
                    <div
                      key={insight.symptomId}
                      onClick={() => handleCardClick(insight.symptomId)}
                      style={{
                        background: insight.direction === 'improving'
                          ? 'rgba(16, 185, 129, 0.05)'
                          : 'rgba(244, 63, 94, 0.05)',
                        border: `1px solid ${insight.direction === 'improving' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`,
                        borderRadius: '16px',
                        padding: '20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                      }}>
                        <div style={{
                          fontSize: '26px',
                          fontWeight: '700',
                          letterSpacing: '-0.025em',
                          color: lineColor,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          minWidth: '90px',
                        }}>
                          <span style={{ fontSize: '22px' }}>{insight.direction === 'improving' ? '↓' : '↑'}</span>
                          {insight.absoluteChange} pts
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: insight.direction === 'improving' ? '#d1fae5' : '#ffe4e6', fontSize: '16px', fontWeight: '500' }}>
                            {insight.name}
                          </div>
                          <div style={{ color: mutedColor, fontSize: '14px', marginTop: '2px' }}>
                            vs previous {insightsWindow - 7} days
                          </div>
                        </div>
                        <div style={{
                          color: insight.direction === 'improving' ? 'rgba(110, 231, 183, 0.4)' : 'rgba(251, 113, 133, 0.4)',
                          fontSize: '18px',
                          transition: 'transform 0.2s ease',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}>
                          ▾
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{
                          marginTop: '16px',
                          paddingTop: '16px',
                          borderTop: `1px solid ${insight.direction === 'improving' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)'}`,
                        }}>
                          {/* This Week vs Previous */}
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            marginBottom: '16px',
                            color: textColor,
                            fontSize: '14px',
                          }}>
                            <div>
                              <span style={{ fontWeight: '500' }}>This week:</span>{' '}
                              <span style={{ fontWeight: '600' }}>{insight.thisWeekAvg}</span> avg
                              <span style={{ color: dimColor }}> ({insight.daysThisWeek} days)</span>
                            </div>
                            <div>
                              <span style={{ fontWeight: '500' }}>Previous:</span>{' '}
                              <span>{insight.previousAvg}</span> avg
                            </div>
                          </div>

                          {/* Best/Worst Days */}
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            marginBottom: '16px',
                            color: textColor,
                            fontSize: '14px',
                          }}>
                            <div>
                              <span style={{ color: '#34d399' }}>Best:</span>{' '}
                              {insight.bestDay.severity} on {formatShortDate(insight.bestDay.date)}
                            </div>
                            <div>
                              <span style={{ color: '#fb7185' }}>Worst:</span>{' '}
                              {insight.worstDay.severity} on {formatShortDate(insight.worstDay.date)}
                            </div>
                          </div>

                          {/* Streak Info */}
                          {insight.streak.type !== 'none' && (
                            <div style={{
                              marginBottom: '16px',
                              color: textColor,
                              fontSize: '14px',
                            }}>
                              Current streak:{' '}
                              <span style={{
                                fontWeight: '600',
                                color: insight.streak.type === 'good' ? '#34d399' : '#fb7185'
                              }}>
                                {insight.streak.days} {insight.streak.type} days
                              </span>
                            </div>
                          )}

                          {/* Frequency */}
                          <div style={{
                            marginBottom: '16px',
                            color: dimColor,
                            fontSize: '13px',
                          }}>
                            Appeared {insight.daysThisWeek} of 7 days this week
                          </div>

                          {/* Sparkline */}
                          {insight.chartData && insight.chartData.length >= 2 && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onOpenGraph) onOpenGraph(insight.symptomId);
                              }}
                              style={{ marginBottom: '4px', cursor: 'pointer' }}
                            >
                              <Sparkline
                                data={insight.chartData}
                                color={lineColor}
                              />
                              <div style={{
                                color: dimColor,
                                fontSize: '11px',
                                textAlign: 'center',
                                marginTop: '4px',
                              }}>
                                Tap for full history
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Symptom cluster */}
            {data.topCluster && (
              <div style={{
                background: 'rgba(251, 146, 60, 0.05)',
                border: '1px solid rgba(251, 146, 60, 0.2)',
                borderRadius: '16px',
                padding: '20px',
                marginBottom: '32px',
              }}>
                <div style={{
                  fontSize: '28px',
                  fontWeight: '800',
                  color: '#fbbf24',
                  marginBottom: '8px',
                }}>
                  {data.topCluster.percent}% of days
                </div>
                <div style={{ color: '#f8fafc', fontSize: '14px' }}>
                  <strong>{data.topCluster.names[0]}</strong> and <strong>{data.topCluster.names[1]}</strong> appear together
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '6px' }}>
                  These symptoms may be related
                </div>
              </div>
            )}

            <p style={{
              color: '#737373',
              fontSize: '12px',
              textAlign: 'center',
              margin: '0 auto',
              maxWidth: '320px',
              lineHeight: '1.625',
            }}>
              Based on {data.entriesCount} entries over {data.daysOfData} days.<br />
              For informational purposes only.
            </p>
            </div>

            {/* Right column (or continuation on mobile): Supplement adherence */}
            <div>
        {/* Supplement Adherence Section */}
        {stackItems && stackEntries && (() => {
          const activeSupplements = (stackItems || []).filter(i => i.active);
          if (activeSupplements.length === 0) return null;

          const supplementStats = activeSupplements.map(item => {
            const current = getSupplementAdherence(item.id, stackEntries, stackItems, 7);
            const previous = getSupplementAdherence(item.id, stackEntries, stackItems, insightsWindow);
            const prevWeek = getSupplementAdherence(item.id, stackEntries, stackItems, 14);
            const trend = current.rate - (prevWeek.rate > 0 ? prevWeek.rate : previous.rate);
            return {
              id: item.id,
              name: item.name,
              currentRate: current.rate,
              overallRate: previous.rate,
              trend,
              taken: previous.taken,
              scheduled: previous.scheduled,
            };
          }).filter(s => s.scheduled > 0)
            .sort((a, b) => Math.abs(b.trend) - Math.abs(a.trend));

          if (supplementStats.length === 0) return null;

          return (
            <div style={{ marginTop: '32px' }}>
              <div style={{
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: '#6b7280',
                marginBottom: '16px',
              }}>
                Supplement Adherence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {supplementStats.map(stat => {
                  const isImproving = stat.trend > 5;
                  const isDeclining = stat.trend < -5;
                  const trendColor = isImproving ? '#34d399' : isDeclining ? '#fb7185' : '#9ca3af';
                  const bgColor = isImproving
                    ? 'rgba(16, 185, 129, 0.05)'
                    : isDeclining
                      ? 'rgba(244, 63, 94, 0.05)'
                      : 'rgba(255, 255, 255, 0.02)';
                  const borderColor = isImproving
                    ? 'rgba(16, 185, 129, 0.15)'
                    : isDeclining
                      ? 'rgba(244, 63, 94, 0.15)'
                      : 'rgba(255, 255, 255, 0.06)';

                  return (
                    <div
                      key={stat.id}
                      onClick={() => {
                        haptic('light');
                        if (onOpenSupplementGraph) onOpenSupplementGraph(stat.id);
                      }}
                      style={{
                        background: bgColor,
                        border: `1px solid ${borderColor}`,
                        borderRadius: '12px',
                        padding: '14px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          color: '#e5e7eb',
                          fontSize: '15px',
                          fontWeight: '500',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {stat.name}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px' }}>
                          {stat.taken}/{stat.scheduled} days taken
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
                        <div style={{
                          fontSize: '18px',
                          fontWeight: '700',
                          color: stat.overallRate >= 80 ? '#34d399' : stat.overallRate >= 50 ? '#fbbf24' : '#fb7185',
                        }}>
                          {stat.overallRate}%
                        </div>
                        {Math.abs(stat.trend) > 5 && (
                          <div style={{ color: trendColor, fontSize: '12px', fontWeight: '500' }}>
                            {stat.trend > 0 ? '+' : ''}{Math.round(stat.trend)}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                color: '#4b5563',
                fontSize: '11px',
                textAlign: 'center',
                marginTop: '12px',
              }}>
                Tap a supplement for full history
              </div>
            </div>
          );
        })()}
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
