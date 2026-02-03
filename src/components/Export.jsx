import { generateAIDataExport, exportCSV, haptic } from '../utils/helpers';

export default function Export({
  entries,
  symptoms,
  dailyNotes,
  stackItems,
  stackEntries,
  trackingMode,
  setCopyToastMessage,
  onClose,
}) {
  const copyAIData = (days) => {
    const data = generateAIDataExport(days, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode);
    navigator.clipboard.writeText(data);
    onClose();
    setCopyToastMessage(`Copied ${days} days to clipboard`);
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 1500);
  };

  const handleExportCSV = (days) => {
    exportCSV(days, entries, symptoms, trackingMode);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        overflowY: 'auto',
        padding: '20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '600px', margin: '0 auto' }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}>
          <h2 style={{ color: '#f8fafc', fontSize: '28px', fontWeight: '700', margin: 0, letterSpacing: '-0.5px' }}>
            Export
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b5cf6',
              fontSize: '17px',
              cursor: 'pointer',
              padding: '8px',
            }}
          >
            Done
          </button>
        </div>

        {/* Copy to Clipboard Section */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          COPY TO CLIPBOARD
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: '7 days', days: 7 },
              { label: '14 days', days: 14 },
              { label: '30 days', days: 30 },
              { label: '60 days', days: 60 },
            ].map(({ label, days }) => (
              <button
                key={days}
                onClick={() => copyAIData(days)}
                style={{
                  background: 'rgba(139, 92, 246, 0.2)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px',
                  color: '#c4b5fd',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{
            color: '#64748b',
            fontSize: '12px',
            margin: '12px 0 0 0',
            textAlign: 'center',
          }}>
            Copies as markdown tables
          </p>
        </div>

        {/* Download CSV Section */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          DOWNLOAD TRACKING DATA
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}>
          {[
            { label: 'Last 7 days', days: 7 },
            { label: 'Last 30 days', days: 30 },
            { label: 'Last 3 months', days: 90 },
            { label: 'Last 6 months', days: 180 },
            { label: 'Last 12 months', days: 365 },
            { label: 'All time', days: 99999 },
          ].map(({ label, days }, index, arr) => (
            <button
              key={days}
              onClick={() => handleExportCSV(days)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: index < arr.length - 1 ? '1px solid rgba(100, 116, 139, 0.15)' : 'none',
                padding: '14px 16px',
                color: '#f8fafc',
                fontSize: '15px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
