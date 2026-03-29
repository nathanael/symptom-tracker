import ComparisonStudio from './ComparisonStudio';

export default function Insights({
  entries,
  symptoms,
  stackItems,
  stackEntries,
  isDesktop,
  trackingMode,
  setStackItems,
}) {
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
        <ComparisonStudio
          entries={entries}
          symptoms={symptoms}
          stackItems={stackItems}
          stackEntries={stackEntries}
          trackingMode={trackingMode}
          isDesktop={isDesktop}
          setStackItems={setStackItems}
        />
      </div>
    </div>
  );
}
