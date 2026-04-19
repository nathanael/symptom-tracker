import React from 'react';
import { useGarminSleep } from '../hooks/useGarminSleep';

export default function SleepAnalyzer({ user, isDesktop }) {
  const { days, loading, error } = useGarminSleep(user);

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
    <div style={styles.root}>
      <div>Loaded {days.length} days of sleep data.</div>
    </div>
  );
}

const styles = {
  root: { color: '#e5e7eb' },
  empty: { color: '#9ca3af', padding: '24px', textAlign: 'center' },
};
