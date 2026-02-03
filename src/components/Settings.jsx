import { useState, useRef } from 'react';
import { trackingModes } from '../utils/constants';
import { isStandalone, getDateKey, haptic } from '../utils/helpers';

export default function Settings({
  user,
  syncing,
  lastSynced,
  syncError,
  setSyncError,
  firebaseError,
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
  copyDays,
  setCopyDays,
  setLastAction,
  setCopyToastMessage,
}) {
  const [confirmClearData, setConfirmClearData] = useState(false);
  const [confirmFullReset, setConfirmFullReset] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

  const fileInputRef = useRef(null);

  const clearAllData = () => {
    if (!confirmClearData) {
      setConfirmClearData(true);
      return;
    }
    setEntries({});
    setStackEntries({});
    setDailyNotes({});
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
      version: '3.5',
      exportedAt: new Date().toISOString(),
      symptoms,
      entries,
      dailyNotes,
      stackItems,
      stackEntries,
      trackingMode,
      pinnedSymptoms: [...pinnedSymptoms],
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

        if (backup.symptoms) setSymptoms(backup.symptoms);
        if (backup.entries) setEntries(backup.entries);
        if (backup.dailyNotes) setDailyNotes(backup.dailyNotes);
        if (backup.stackItems) setStackItems(backup.stackItems);
        if (backup.stackEntries) setStackEntries(backup.stackEntries);
        if (backup.trackingMode) setTrackingMode(backup.trackingMode);
        if (backup.pinnedSymptoms) setPinnedSymptoms(new Set(backup.pinnedSymptoms));

        setLastAction(`Restored backup from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString() : 'file'}`);
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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#08090A',
        zIndex: 100,
        overflowY: 'auto',
        padding: '20px 24px 120px 24px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      <div style={{ maxWidth: '500px', margin: '0 auto' }}>
        {/* Header */}
        <h2 style={{
          color: '#f8fafc',
          fontSize: '28px',
          fontWeight: '700',
          margin: '0 0 24px 0',
          letterSpacing: '-0.5px',
        }}>
          Settings
        </h2>

        {/* Cloud Sync Section */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          CLOUD SYNC
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
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
                onClick={() => { setIsSignUp(!isSignUp); setSyncError(null); }}
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

              {!isStandalone() && (
                <>
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
                </>
              )}

              {syncError && (
                <div style={{
                  color: '#f87171',
                  fontSize: '11px',
                  marginTop: '10px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  padding: '8px',
                  borderRadius: '3px',
                }}>
                  {syncError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Tracking Mode Selection */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          TRACKING MODE
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '20px',
          overflow: 'hidden',
        }}>
          {Object.entries(trackingModes).map(([key, mode], index, arr) => (
            <button
              key={key}
              onClick={() => setTrackingMode(key)}
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div>{mode.label}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{mode.description}</div>
              </div>
              {trackingMode === key && <span style={{ color: '#8b5cf6', fontSize: '18px' }}>✓</span>}
            </button>
          ))}
        </div>

        {/* Copy Days Setting */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          QUICK COPY
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '20px',
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
                    background: copyDays === days ? 'rgba(34, 197, 94, 0.2)' : 'rgba(99, 102, 241, 0.1)',
                    border: copyDays === days ? '2px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(99, 102, 241, 0.2)',
                    borderRadius: '8px',
                    color: copyDays === days ? '#4ade80' : '#94a3b8',
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

        {/* Backup Section */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          BACKUP
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '20px',
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

        {/* Danger Zone */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          DANGER ZONE
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '20px',
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

        {/* About Section */}
        <div style={{ marginBottom: '8px', color: '#64748b', fontSize: '13px', fontWeight: '500', paddingLeft: '4px' }}>
          ABOUT
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          marginBottom: '20px',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(100, 116, 139, 0.15)' }}>
            <div style={{ color: '#f8fafc', fontSize: '15px', marginBottom: '4px' }}>Version</div>
            <div style={{ color: '#64748b', fontSize: '13px' }}>
              3.5.5 ({isStandalone() ? 'Home Screen App' : 'Browser'})
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
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '14px 16px',
              color: checkingForUpdates ? '#64748b' : '#8b5cf6',
              fontSize: '15px',
              cursor: checkingForUpdates ? 'default' : 'pointer',
              textAlign: 'left',
              opacity: checkingForUpdates ? 0.7 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{checkingForUpdates ? 'Checking...' : 'Check for Updates'}</span>
              {checkingForUpdates && (
                <span style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid #64748b',
                  borderTopColor: '#8b5cf6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
              )}
            </div>
          </button>
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
  );
}
