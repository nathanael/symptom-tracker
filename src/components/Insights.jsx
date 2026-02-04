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
    setCopyToastMessage('Copied 60 days of tracking for AI chat');
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 2250);
  };

  return (
    <div
      style={{
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
      <div style={{ maxWidth: '500px', margin: '0 auto' }}>
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
          <>
            {/* Insights tiles */}
            {data.insights.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
                {data.insights.map(insight => (
                  <div
                    key={insight.symptomId}
                    style={{
                      background: insight.direction === 'improving'
                        ? 'rgba(16, 185, 129, 0.05)'
                        : 'rgba(244, 63, 94, 0.05)',
                      border: `1px solid ${insight.direction === 'improving' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`,
                      borderRadius: '16px',
                      padding: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '20px',
                    }}
                  >
                    <div style={{
                      fontSize: '30px',
                      fontWeight: '700',
                      letterSpacing: '-0.025em',
                      color: insight.direction === 'improving' ? '#34d399' : '#fb7185',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      <span style={{ fontSize: '24px' }}>{insight.direction === 'improving' ? '↓' : '↑'}</span>
                      {insight.percentChange}%
                    </div>
                    <div>
                      <div style={{ color: insight.direction === 'improving' ? '#d1fae5' : '#ffe4e6', fontSize: '16px', fontWeight: '500' }}>
                        {insight.name}
                      </div>
                      <div style={{ color: insight.direction === 'improving' ? 'rgba(110, 231, 183, 0.6)' : 'rgba(251, 113, 133, 0.6)', fontSize: '14px', marginTop: '2px' }}>
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

            {/* Copy button */}
            <button
              onClick={handleCopy}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                background: '#4f46e5',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                padding: '16px 24px',
                color: '#fff',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer',
                marginBottom: '24px',
                boxShadow: '0 10px 15px -3px rgba(49, 46, 129, 0.2)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(199, 210, 254, 0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
              Copy Tracking Data
            </button>

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
          </>
        )}
      </div>
    </div>
  );
}
