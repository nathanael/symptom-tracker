import { useState, useRef } from 'react';
import { trackingModes } from '../utils/constants';
import { isStandalone, getDateKey, haptic, generateAIDataExport } from '../utils/helpers';
import { mergeSupplements, previewMerge, renameSupplement, deleteSupplement, previewDelete } from '../utils/supplementTools';

export default function Settings({
  user,
  syncing,
  lastSynced,
  syncError,
  setSyncError,
  firebaseError,
  authError,
  setAuthError,
  signInWithGoogle,
  signInWithEmail,
  forgotPassword,
  signOut,
  trackingMode,
  setTrackingMode,
  symptoms,
  setSymptoms,
  entries,
  setEntries,
  dailyNotes,
  setDailyNotes,
  stackItems,
  setStackItems,
  stackEntries,
  setStackEntries,
  pinnedSymptoms,
  setPinnedSymptoms,
  inputItems,
  setInputItems,
  inputEntries,
  setInputEntries,
  copyDays,
  setCopyDays,
  trendWindow,
  setTrendWindow,
  setLastAction,
  setCopyToastMessage,
  setShowExport,
  setShowSettings,
  isDesktop,
  onForcePush,
}) {
  const [confirmClearData, setConfirmClearData] = useState(false);
  const [confirmFullReset, setConfirmFullReset] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState('sum');
  const [confirmMerge, setConfirmMerge] = useState(false);

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mergePreview = (mergeTarget && mergeSource && mergeTarget !== mergeSource)
    ? previewMerge(stackEntries, mergeTarget, mergeSource)
    : null;

  const deletePreview = deleteTarget ? previewDelete(stackEntries, deleteTarget) : null;

  const fileInputRef = useRef(null);

  const clearAllData = () => {
    if (!confirmClearData) {
      setConfirmClearData(true);
      return;
    }
    setEntries(() => ({}));
    setStackEntries(() => ({}));
    setInputEntries(() => ({}));
    setDailyNotes(() => ({}));
    setConfirmClearData(false);
    setLastAction('All data cleared');
  };

  const fullReset = () => {
    if (!confirmFullReset) {
      setConfirmFullReset(true);
      return;
    }
    localStorage.clear();
    window.location.reload();
  };

  const backupToFile = () => {
    const backup = {
      version: '4.8.3',
      exportedAt: new Date().toISOString(),
      symptoms,
      entries,
      dailyNotes,
      stackItems,
      stackEntries,
      trackingMode,
      pinnedSymptoms: [...pinnedSymptoms],
      inputItems,
      inputEntries,
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `symptom-tracker-backup-${getDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastAction('Backup downloaded - save to iCloud Drive');
  };

  const restoreFromFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);

        // Merge restore: backup fills in missing data without overwriting existing
        // Count additions outside setState closures to avoid batching issues
        const addedRef = { count: 0 };
        if (backup.symptoms) setSymptoms(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          backup.symptoms.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); addedRef.count++; } });
          return Array.from(map.values());
        });
        if (backup.entries) setEntries(prev => {
          const merged = { ...prev };
          Object.entries(backup.entries).forEach(([k, v]) => { if (!merged[k]) { merged[k] = v; addedRef.count++; } });
          return merged;
        });
        if (backup.dailyNotes) setDailyNotes(prev => {
          const merged = { ...prev };
          Object.entries(backup.dailyNotes).forEach(([k, v]) => { if (!merged[k]) { merged[k] = v; addedRef.count++; } });
          return merged;
        });
        if (backup.stackItems) setStackItems(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          backup.stackItems.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); addedRef.count++; } });
          return Array.from(map.values());
        });
        if (backup.stackEntries) setStackEntries(prev => {
          const merged = { ...prev };
          Object.entries(backup.stackEntries).forEach(([k, v]) => { if (!merged[k]) { merged[k] = v; addedRef.count++; } });
          return merged;
        });
        if (backup.inputItems) setInputItems(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          backup.inputItems.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); addedRef.count++; } });
          return Array.from(map.values());
        });
        if (backup.inputEntries) setInputEntries(prev => {
          const merged = { ...prev };
          Object.entries(backup.inputEntries).forEach(([k, v]) => { if (!merged[k]) { merged[k] = v; addedRef.count++; } });
          return merged;
        });
        if (backup.trackingMode) setTrackingMode(backup.trackingMode);
        if (backup.pinnedSymptoms) setPinnedSymptoms(new Set(backup.pinnedSymptoms));

        setLastAction(addedRef.count > 0
          ? `Merged ${addedRef.count} missing entries from backup`
          : 'Backup loaded but no missing entries found — all data already present');
      } catch (err) {
        setLastAction('Error: Invalid backup file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    const success = await signInWithEmail(authEmail, authPassword, isSignUp);
    if (success) {
      setAuthEmail('');
      setAuthPassword('');
    }
  };

  const handleForgotPassword = async () => {
    const success = await forgotPassword(authEmail);
    if (success) {
      alert('Password reset email sent to ' + authEmail + '\n\nCheck your inbox (and spam folder).');
    }
  };

  return (
    <div
      style={isDesktop ? {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      } : {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#08090A',
        zIndex: 100,
        overflowY: 'auto',
        padding: '16px 16px 120px 16px',
        paddingTop: 'calc(16px + env(safe-area-inset-top))',
      }}
      onClick={isDesktop ? () => setShowSettings(false) : undefined}
    >
      <div
        style={isDesktop ? {
          width: '420px',
          height: '100%',
          background: '#1a1b1e',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.2s ease-out',
        } : {
          maxWidth: '700px',
          margin: '0 auto',
        }}
        onClick={isDesktop ? (e) => e.stopPropagation() : undefined}
      >
        {isDesktop && (
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
              Settings
            </h3>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#9ca3af',
                fontSize: '14px',
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: '6px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div style={isDesktop ? {
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
        } : {}}>

        {/* Cloud Sync Section */}
        <div style={{ marginBottom: '8px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          CLOUD SYNC
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '12px',
        }}>
          {firebaseError ? (
            <div style={{
              color: '#f87171',
              fontSize: '12px',
              lineHeight: '1.5',
              background: 'rgba(239, 68, 68, 0.1)',
              padding: '12px',
              borderRadius: '3px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>Cloud sync unavailable</div>
              <span>{firebaseError}</span>
            </div>
          ) : user ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: '600',
                  overflow: 'hidden',
                }}>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (user.displayName || user.email || 'U')[0].toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '600' }}>
                    {user.displayName || user.email?.split('@')[0] || 'User'}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>
                    {user.email}
                  </div>
                </div>
                <button
                  onClick={signOut}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    color: '#ef4444',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Sign Out
                </button>
              </div>

              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(100, 116, 139, 0.2)',
                color: '#64748b',
                fontSize: '13px',
              }}>
                {syncing ? (
                  <span>Syncing...</span>
                ) : lastSynced ? (
                  <span>Last synced {lastSynced.toLocaleTimeString()}</span>
                ) : (
                  <span>Auto-sync enabled</span>
                )}
              </div>

              {syncError && (
                <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>
                  {syncError}
                </div>
              )}

              <button
                onClick={async () => {
                  if (onForcePush) {
                    await onForcePush();
                    setLastAction('Data pushed to cloud');
                  }
                }}
                disabled={syncing}
                style={{
                  marginTop: '12px',
                  width: '100%',
                  padding: '10px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '8px',
                  color: '#a5b4fc',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  opacity: syncing ? 0.5 : 1,
                }}
              >
                Force Push to Cloud
              </button>

              <button
                onClick={() => {
                  if (confirm('This will clear local data and reload from the cloud. Continue?')) {
                    const keys = Object.keys(localStorage).filter(k => k.startsWith('symptomTracker_') || k.startsWith('syncDirty_'));
                    keys.forEach(k => localStorage.removeItem(k));
                    setLastAction('Local data cleared, reloading...');
                    setTimeout(() => location.reload(), 500);
                  }
                }}
                disabled={syncing}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '10px',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '8px',
                  color: '#86efac',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  opacity: syncing ? 0.5 : 1,
                }}
              >
                Force Pull from Cloud
              </button>
            </>
          ) : (
            <>
              <p style={{
                color: '#94a3b8',
                fontSize: '12px',
                margin: '0 0 12px 0',
                lineHeight: '1.4',
              }}>
                {isSignUp ? 'Create an account' : 'Sign in'} to sync across devices
              </p>

              <form onSubmit={handleEmailSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="email"
                  style={{
                    width: '100%',
                    background: 'rgba(15, 17, 21, 0.8)',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '3px',
                    padding: '12px',
                    color: '#f8fafc',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  style={{
                    width: '100%',
                    background: 'rgba(15, 17, 21, 0.8)',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: '3px',
                    padding: '12px',
                    color: '#f8fafc',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={syncing}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(99, 102, 241, 0.3) 100%)',
                    border: '1px solid rgba(139, 92, 246, 0.5)',
                    borderRadius: '3px',
                    padding: '12px 16px',
                    color: '#e2e8f0',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: syncing ? 'not-allowed' : 'pointer',
                    opacity: syncing ? 0.7 : 1,
                  }}
                >
                  {syncing ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                </button>
              </form>

              <button
                onClick={() => { setIsSignUp(!isSignUp); if (setAuthError) setAuthError(null); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: '#8b5cf6',
                  fontSize: '12px',
                  marginTop: '10px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
              </button>

              {!isSignUp && (
                <button
                  onClick={handleForgotPassword}
                  disabled={syncing}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '12px',
                    marginTop: '8px',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Forgot password?
                </button>
              )}

              <div style={{
                display: 'flex',
                alignItems: 'center',
                margin: '16px 0',
                gap: '12px',
              }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(100, 116, 139, 0.3)' }} />
                <span style={{ color: '#64748b', fontSize: '11px' }}>or</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(100, 116, 139, 0.3)' }} />
              </div>

              <button
                onClick={signInWithGoogle}
                disabled={syncing}
                style={{
                  width: '100%',
                  background: 'rgba(15, 17, 21, 0.6)',
                  border: '1px solid rgba(100, 116, 139, 0.3)',
                  borderRadius: '3px',
                  padding: '12px 16px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  opacity: syncing ? 0.7 : 1,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v3.07h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v3.04C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {authError && (
                <div style={{
                  color: '#f87171',
                  fontSize: '11px',
                  marginTop: '10px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  padding: '8px',
                  borderRadius: '3px',
                }}>
                  {authError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Tracking Mode Selection */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          TRACKING MODE
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          padding: '4px',
          display: 'flex',
          gap: '4px',
        }}>
          {Object.entries(trackingModes).map(([key, mode]) => (
            <button
              key={key}
              onClick={() => setTrackingMode(key)}
              style={{
                flex: 1,
                background: trackingMode === key ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.05)',
                border: trackingMode === key ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.15)',
                borderRadius: '8px',
                padding: '10px 8px',
                color: trackingMode === key ? '#a5b4fc' : '#64748b',
                fontSize: '13px',
                fontWeight: trackingMode === key ? '600' : '500',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Copy Days Setting */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          QUICK COPY
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              Default number of days for copy button
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 7, 14, 30, 60].map(days => (
                <button
                  key={days}
                  onClick={() => setCopyDays(days)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    background: copyDays === days ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.05)',
                    border: copyDays === days ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.15)',
                    borderRadius: '8px',
                    color: copyDays === days ? '#a5b4fc' : '#64748b',
                    fontSize: '14px',
                    fontWeight: copyDays === days ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  {days}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Trend Indicator Window Setting */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          TREND INDICATOR
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              Days to analyze for trend arrows (↑↓)
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setTrendWindow(days)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    background: trendWindow === days ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.05)',
                    border: trendWindow === days ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.15)',
                    borderRadius: '8px',
                    color: trendWindow === days ? '#a5b4fc' : '#64748b',
                    fontSize: '14px',
                    fontWeight: trendWindow === days ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  {days}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Copy for AI Section */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          QUICK COPY FOR AI
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '12px',
        }}>
          <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '10px' }}>
            Copy tracking data to clipboard for AI chat
          </div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '2px' }}>
            {[30, 60, 90].map(days => (
              <button
                key={days}
                onClick={() => {
                  const data = generateAIDataExport(days, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode, null, inputItems, inputEntries);
                  navigator.clipboard.writeText(data);
                  setCopyToastMessage(`Copied ${days} days of tracking for AI chat`);
                  haptic('light');
                  setTimeout(() => setCopyToastMessage(''), 2250);
                }}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  background: 'rgba(139, 92, 246, 0.2)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#c4b5fd',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                {days}d
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setShowSettings(false);
              setShowExport(true);
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '0',
              color: '#8b5cf6',
              fontSize: '14px',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            More options
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        {/* Backup Section */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          BACKUP
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              Save to Files to sync between devices
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={backupToFile}
                style={{
                  flex: 1,
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px',
                  color: '#a5b4fc',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                Save Backup
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1,
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px',
                  color: '#a5b4fc',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                Load Backup
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={restoreFromFile}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* About Section */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          ABOUT
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#f8fafc', fontSize: '14px', fontWeight: '500' }}>
              v5.1.0
            </div>
            <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
              {isStandalone() ? 'Home Screen App' : 'Browser'}
            </div>
          </div>
          <button
            onClick={async () => {
              if (checkingForUpdates) return;
              setCheckingForUpdates(true);
              haptic('light');

              sessionStorage.setItem('justCheckedForUpdates', 'true');

              if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.map(name => caches.delete(name)));
              }
              if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(reg => reg.unregister()));
              }
              window.location.reload(true);
            }}
            disabled={checkingForUpdates}
            style={{
              background: 'rgba(139, 92, 246, 0.15)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: checkingForUpdates ? '#64748b' : '#a5b4fc',
              fontSize: '13px',
              fontWeight: '500',
              cursor: checkingForUpdates ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {checkingForUpdates ? (
              <>
                <span style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid #64748b',
                  borderTopColor: '#8b5cf6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                Checking
              </>
            ) : (
              'Check for Updates'
            )}
          </button>
        </div>

        {/* Merge Supplements */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          DATA TOOLS
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => { setShowMergeModal(true); setMergeTarget(''); setMergeSource(''); setMergeStrategy('sum'); setConfirmMerge(false); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(100, 116, 139, 0.15)',
              padding: '14px 16px',
              color: '#a5b4fc',
              fontSize: '15px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>Merge Supplements</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Combine duplicate supplements into one</div>
          </button>
          <button
            onClick={() => { setShowRenameModal(true); setRenameTarget(''); setRenameValue(''); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(100, 116, 139, 0.15)',
              padding: '14px 16px',
              color: '#a5b4fc',
              fontSize: '15px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>Rename Supplement</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Change a supplement's display name</div>
          </button>
          <button
            onClick={() => { setShowDeleteModal(true); setDeleteTarget(''); setConfirmDelete(false); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '14px 16px',
              color: '#fca5a5',
              fontSize: '15px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>Delete Supplement</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Permanently remove a supplement and all its entries</div>
          </button>
        </div>

        {showMergeModal && (
          <div
            onClick={() => setShowMergeModal(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: '400px',
                background: 'rgba(15,17,21,0.95)',
                borderRadius: '12px',
                border: '1px solid rgba(139,92,246,0.3)',
                padding: '20px',
              }}
            >
              <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: '0 0 16px' }}>
                Merge Supplements
              </h3>

              {/* Target dropdown */}
              <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
                Keep (target)
              </label>
              <select
                value={mergeTarget}
                onChange={(e) => { setMergeTarget(e.target.value); if (e.target.value === mergeSource) setMergeSource(''); setConfirmMerge(false); }}
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: '12px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
                }}
              >
                <option value="">Select supplement to keep...</option>
                {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
                ))}
              </select>

              {/* Source dropdown */}
              <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
                Merge & delete (source)
              </label>
              <select
                value={mergeSource}
                onChange={(e) => { setMergeSource(e.target.value); setConfirmMerge(false); }}
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: '12px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
                }}
              >
                <option value="">Select supplement to merge...</option>
                {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).filter(i => i.id !== mergeTarget).map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
                ))}
              </select>

              {/* Strategy toggle */}
              <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
                When both have entries on the same day
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                {['sum', 'higher'].map(s => (
                  <button
                    key={s}
                    onClick={() => setMergeStrategy(s)}
                    style={{
                      flex: 1, padding: '8px',
                      borderRadius: '6px', border: 'none',
                      background: mergeStrategy === s ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.04)',
                      color: mergeStrategy === s ? '#c4b5fd' : '#6b7280',
                      fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                    }}
                  >
                    {s === 'sum' ? 'Sum doses' : 'Keep higher'}
                  </button>
                ))}
              </div>

              {/* Preview */}
              {mergePreview && (() => {
                const targetItem = (stackItems || []).find(i => i.id === mergeTarget);
                const sourceItem = (stackItems || []).find(i => i.id === mergeSource);
                const unitMismatch = targetItem && sourceItem && (targetItem.unit || 'mg') !== (sourceItem.unit || 'mg');
                return (
                  <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#9ca3af',
                    lineHeight: '1.6',
                  }}>
                    <div>{mergePreview.sourceEntryCount} entries will be moved</div>
                    {mergePreview.conflictCount > 0 && (
                      <div style={{ color: '#fbbf24' }}>
                        {mergePreview.conflictCount} date conflict{mergePreview.conflictCount > 1 ? 's' : ''} ({mergeStrategy === 'sum' ? 'doses will be summed' : 'higher dose kept'})
                      </div>
                    )}
                    {unitMismatch && (
                      <div style={{ color: '#fb923c' }}>
                        Warning: different units ({targetItem.unit || 'mg'} vs {sourceItem.unit || 'mg'})
                      </div>
                    )}
                    <div style={{ color: '#fca5a5', marginTop: '4px' }}>
                      &quot;{sourceItem?.name}&quot; will be permanently deleted
                    </div>
                  </div>
                );
              })()}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowMergeModal(false)}
                  style={{
                    flex: 1, padding: '10px',
                    background: 'rgba(99,102,241,0.2)', border: 'none', borderRadius: '8px',
                    color: '#a5b4fc', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!mergeTarget || !mergeSource || mergeTarget === mergeSource) return;
                    if (!confirmMerge) { setConfirmMerge(true); return; }
                    const sourceName = (stackItems || []).find(i => i.id === mergeSource)?.name;
                    const targetName = (stackItems || []).find(i => i.id === mergeTarget)?.name;
                    const result = mergeSupplements(stackItems, stackEntries, mergeTarget, mergeSource, mergeStrategy);
                    setStackItems(() => result.stackItems);
                    setStackEntries(() => result.stackEntries);
                    setShowMergeModal(false);
                    setLastAction(`Merged "${sourceName}" into "${targetName}" (${mergePreview?.sourceEntryCount || 0} entries moved)`);
                    haptic('success');
                  }}
                  disabled={!mergeTarget || !mergeSource || mergeTarget === mergeSource}
                  style={{
                    flex: 1, padding: '10px',
                    background: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 'rgba(139,92,246,0.1)' : confirmMerge ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.4)',
                    border: 'none', borderRadius: '8px',
                    color: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? '#6b7280' : confirmMerge ? '#fca5a5' : '#e9d5ff',
                    fontSize: '14px', fontWeight: '600', cursor: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 'default' : 'pointer',
                    opacity: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 0.5 : 1,
                  }}
                >
                  {confirmMerge ? 'Confirm Merge' : 'Merge'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showRenameModal && (
          <div
            onClick={() => setShowRenameModal(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: '400px',
                background: 'rgba(15,17,21,0.95)',
                borderRadius: '12px',
                border: '1px solid rgba(139,92,246,0.3)',
                padding: '20px',
              }}
            >
              <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: '0 0 16px' }}>
                Rename Supplement
              </h3>

              <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
                Supplement
              </label>
              <select
                value={renameTarget}
                onChange={(e) => {
                  setRenameTarget(e.target.value);
                  const item = (stackItems || []).find(i => i.id === e.target.value);
                  setRenameValue(item ? item.name : '');
                }}
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: '12px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
                }}
              >
                <option value="">Select supplement...</option>
                {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
                ))}
              </select>

              {renameTarget && (
                <>
                  <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
                    New name
                  </label>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', marginBottom: '16px',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowRenameModal(false)}
                  style={{
                    flex: 1, padding: '10px',
                    background: 'rgba(99,102,241,0.2)', border: 'none', borderRadius: '8px',
                    color: '#a5b4fc', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!renameTarget || !renameValue.trim()) return;
                    const oldName = (stackItems || []).find(i => i.id === renameTarget)?.name;
                    const newItems = renameSupplement(stackItems, renameTarget, renameValue.trim());
                    setStackItems(() => newItems);
                    setShowRenameModal(false);
                    setLastAction(`Renamed "${oldName}" to "${renameValue.trim()}"`);
                    haptic('success');
                  }}
                  disabled={!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name}
                  style={{
                    flex: 1, padding: '10px',
                    background: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.4)',
                    border: 'none', borderRadius: '8px',
                    color: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? '#6b7280' : '#e9d5ff',
                    fontSize: '14px', fontWeight: '600',
                    cursor: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 'default' : 'pointer',
                    opacity: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 0.5 : 1,
                  }}
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteModal && (
          <div
            onClick={() => setShowDeleteModal(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: '400px',
                background: 'rgba(15,17,21,0.95)',
                borderRadius: '12px',
                border: '1px solid rgba(239,68,68,0.3)',
                padding: '20px',
              }}
            >
              <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: '0 0 16px' }}>
                Delete Supplement
              </h3>

              <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
                Supplement
              </label>
              <select
                value={deleteTarget}
                onChange={(e) => { setDeleteTarget(e.target.value); setConfirmDelete(false); }}
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: '12px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
                }}
              >
                <option value="">Select supplement...</option>
                {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
                ))}
              </select>

              {deleteTarget && deletePreview && (
                <div style={{
                  background: 'rgba(239,68,68,0.08)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#fca5a5',
                  lineHeight: '1.6',
                }}>
                  <div>{deletePreview.entryCount} historical entries will be permanently deleted</div>
                  <div style={{ marginTop: '4px' }}>
                    &quot;{(stackItems || []).find(i => i.id === deleteTarget)?.name}&quot; cannot be recovered
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  style={{
                    flex: 1, padding: '10px',
                    background: 'rgba(99,102,241,0.2)', border: 'none', borderRadius: '8px',
                    color: '#a5b4fc', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!deleteTarget) return;
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    const itemName = (stackItems || []).find(i => i.id === deleteTarget)?.name;
                    const result = deleteSupplement(stackItems, stackEntries, deleteTarget);
                    setStackItems(() => result.stackItems);
                    setStackEntries(() => result.stackEntries);
                    setShowDeleteModal(false);
                    setLastAction(`Deleted "${itemName}" (${result.deletedCount} entries removed)`);
                    haptic('success');
                  }}
                  disabled={!deleteTarget}
                  style={{
                    flex: 1, padding: '10px',
                    background: !deleteTarget ? 'rgba(239,68,68,0.1)' : confirmDelete ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)',
                    border: 'none', borderRadius: '8px',
                    color: !deleteTarget ? '#6b7280' : '#fca5a5',
                    fontSize: '14px', fontWeight: '600',
                    cursor: !deleteTarget ? 'default' : 'pointer',
                    opacity: !deleteTarget ? 0.5 : 1,
                  }}
                >
                  {confirmDelete ? 'Confirm Delete' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          DANGER ZONE
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
          {!confirmClearData ? (
            <button
              onClick={clearAllData}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(100, 116, 139, 0.15)',
                padding: '14px 16px',
                color: '#fca5a5',
                fontSize: '15px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div>Clear All Entries</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Keeps symptoms & supplements</div>
            </button>
          ) : (
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(100, 116, 139, 0.15)' }}>
              <div style={{ color: '#fca5a5', fontWeight: '500', marginBottom: '12px', textAlign: 'center' }}>
                Clear all entries? This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setConfirmClearData(false)}
                  style={{
                    flex: 1,
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#a5b4fc',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={clearAllData}
                  style={{
                    flex: 1,
                    background: 'rgba(239, 68, 68, 0.3)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#fca5a5',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {!confirmFullReset ? (
            <button
              onClick={fullReset}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '14px 16px',
                color: '#ef4444',
                fontSize: '15px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div>Full Reset</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Remove everything</div>
            </button>
          ) : (
            <div style={{ padding: '14px 16px' }}>
              <div style={{ color: '#ef4444', fontWeight: '500', marginBottom: '12px', textAlign: 'center' }}>
                Delete EVERYTHING? This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setConfirmFullReset(false)}
                  style={{
                    flex: 1,
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#a5b4fc',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={fullReset}
                  style={{
                    flex: 1,
                    background: 'rgba(239, 68, 68, 0.4)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#fca5a5',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          paddingTop: '20px',
          paddingBottom: '20px',
        }}>
          <span style={{ color: '#475569', fontSize: '12px' }}>
            Symptom Tracker
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
