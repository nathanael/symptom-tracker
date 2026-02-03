import { useMemo } from 'react';
import { getInsights, generateAIDataExport, haptic } from '../utils/helpers';

export default function Insights({
  entries,
  symptoms,
  dailyNotes,
  stackItems,
  stackEntries,
  trackingMode,
  insightsWindow,
  setInsightsWindow,
  setCopyToastMessage,
}) {
  const data = useMemo(() =>
    getInsights(insightsWindow, entries, symptoms),
    [insightsWindow, entries, symptoms]
  );

  const handleCopy = () => {
    const exportData = generateAIDataExport(60, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode);
    navigator.clipboard.writeText(exportData);
    setCopyToastMessage('Copied 60 days to clipboard');
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 1500);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(180deg, #0c0a1d 0%, #1a1333 100%)',
        zIndex: 100,
        overflowY: 'auto',
        padding: '20px 20px 120px 20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '28px', fontWeight: '700', margin: 0, letterSpacing: '-0.5px' }}>
            Insights
          </h2>
        </div>

        {/* Window Selector */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
        }}>
          {[30, 60, 90].map(days => (
            <button
              key={days}
              onClick={() => setInsightsWindow(days)}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '5px',
                border: insightsWindow === days
                  ? '2px solid rgba(99, 102, 241, 0.6)'
                  : '1px solid rgba(99, 102, 241, 0.2)',
                background: insightsWindow === days
                  ? 'rgba(99, 102, 241, 0.2)'
                  : 'rgba(99, 102, 241, 0.05)',
                color: insightsWindow === days ? '#fff' : '#94a3b8',
                fontSize: '13px',
                fontWeight: insightsWindow === days ? '600' : '400',
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
          <>
            {/* Insights tiles */}
            {data.insights.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                {data.insights.map(insight => (
                  <div
                    key={insight.symptomId}
                    style={{
                      background: insight.direction === 'improving'
                        ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(74, 222, 128, 0.1) 100%)'
                        : 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(251, 146, 60, 0.1) 100%)',
                      border: `2px solid ${insight.direction === 'improving' ? 'rgba(74, 222, 128, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                      borderRadius: '3px',
                      padding: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                    }}
                  >
                    <div style={{
                      fontSize: '36px',
                      fontWeight: '800',
                      color: insight.direction === 'improving' ? '#4ade80' : '#f87171',
                      minWidth: '90px',
                    }}>
                      {insight.direction === 'improving' ? '↓' : '↑'}{insight.percentChange}%
                    </div>
                    <div>
                      <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '600' }}>
                        {insight.name}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
                        {insight.direction === 'improving' ? 'Improved' : 'Increased'} over {insightsWindow} days
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Symptom cluster */}
            {data.topCluster && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.15) 0%, rgba(251, 191, 36, 0.1) 100%)',
                border: '2px solid rgba(251, 146, 60, 0.4)',
                borderRadius: '3px',
                padding: '20px',
                marginBottom: '20px',
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

            {/* Copy button */}
            <button
              onClick={handleCopy}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(99, 102, 241, 0.15) 100%)',
                border: '2px solid rgba(139, 92, 246, 0.4)',
                borderRadius: '3px',
                padding: '20px',
                color: '#c4b5fd',
                fontSize: '15px',
                fontWeight: '600',
                cursor: 'pointer',
                textAlign: 'center',
                marginBottom: '20px',
              }}
            >
              <span style={{ fontSize: '20px', marginRight: '8px' }}>📋</span>
              Copy Tracking Data
            </button>

            <p style={{
              color: '#64748b',
              fontSize: '11px',
              textAlign: 'center',
              margin: 0,
            }}>
              Based on {data.entriesCount} entries over {data.daysOfData} days. For informational purposes only.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
