import { useState, useRef } from 'react';
import { trackingModes } from '../utils/constants';
import { isStandalone, getDateKey, haptic, generateAIDataExport } from '../utils/helpers';
import { mergeSupplements, previewMerge, renameSupplement, deleteSupplement, previewDelete } from '../utils/supplementTools';
import { listSnapshots, restoreSnapshot, saveSnapshot } from '../utils/snapshots';

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
  garminSync,
  onForcePush,
  onForcePull,
}) {
  const [confirmClearData, setConfirmClearData] = useState(false);
  const [confirmFullReset, setConfirmFullReset] = useState(false);
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminMfaCode, setGarminMfaCode] = useState('');
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

  const [showRestore, setShowRestore] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [pullPreview, setPullPreview] = useState(null);
  const [pullBusy, setPullBusy] = useState(false);

  const refreshSnapshots = () => setSnapshots(listSnapshots());

  const handlePullMerge = async () => {
    if (!onForcePull || pullBusy) return;
    setPullBusy(true);
    try {
      const result = await onForcePull({ destructive: false });
      if (!result) {
        alert('Pull failed — cloud fetch returned nothing.');
        return;
      }
      const total = Object.values(result.summary).reduce((a, b) => a + b, 0);
      const detail = Object.entries(result.summary).map(([d, n]) => `${d}=${n}`).join(' ');
      setCopyToastMessage?.(`Pulled (merge) ${total}: ${detail}`);
      setTimeout(() => setCopyToastMessage?.(''), 5000);
    } finally {
      setPullBusy(false);
    }
  };

  const handlePullReplacePreview = async () => {
    if (pullBusy) return;
    setPullBusy(true);
    try {
      // Fetch cloud, show what would change, do NOT apply yet
      const user = window.firebase?.auth().currentUser;
      if (!user) { alert('Not signed in'); return; }
      const doc = await window.firebase.firestore().collection('users').doc(user.uid).get({ source: 'server' });
      const c = doc.data();
      if (!c) { alert('Cloud doc not found'); return; }
      const pre = {};
      for (const [name, k] of Object.entries({
        symptoms: 'symptomTracker_symptoms', entries: 'symptomTracker_entries',
        dailyNotes: 'symptomTracker_notes', stackItems: 'symptomTracker_stackItems',
        stackEntries: 'symptomTracker_stackEntries', pinnedSymptoms: 'symptomTracker_pinned',
        trackingMode: 'symptomTracker_mode', inputItems: 'symptomTracker_inputItems',
        inputEntries: 'symptomTracker_inputEntries',
      })) {
        let cv = c[name]; try { if (typeof cv === 'string') cv = JSON.parse(cv); } catch {}
        let lv = null; try { lv = JSON.parse(localStorage.getItem(k) || 'null'); } catch {}
        const sz = v => Array.isArray(v) ? v.length : (v && typeof v === 'object') ? Object.keys(v).length : (v != null ? 1 : 0);
        pre[name] = { cloud: sz(cv), local: sz(lv) };
      }
      setPullPreview(pre);
    } finally {
      setPullBusy(false);
    }
  };

  const handlePullReplaceConfirm = async () => {
    if (!onForcePull) return;
    setPullBusy(true);
    try {
      const result = await onForcePull({ destructive: true });
      if (!result) {
        alert('Pull failed');
        return;
      }
      const total = Object.values(result.summary).reduce((a, b) => a + b, 0);
      setCopyToastMessage?.(`REPLACED with cloud (${total} items). Snapshot saved as ${result.snapshotId}.`);
      setTimeout(() => setCopyToastMessage?.(''), 8000);
      setPullPreview(null);
    } finally {
      setPullBusy(false);
    }
  };

  const handleRestore = (id) => {
    if (confirmRestoreId !== id) {
      setConfirmRestoreId(id);
      return;
    }
    // Save a snapshot of the CURRENT state before restoring, in case the
    // restore turns out to be wrong too.
    saveSnapshot('preRestore');
    const ok = restoreSnapshot(id);
    if (!ok) {
      alert('Restore failed');
      return;
    }
    alert('Restored. Reloading…');
    window.location.reload();
  };

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
      version: '5.2.7',
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

        const msg = addedRef.count > 0
          ? `Merged ${addedRef.count} missing entries from backup`
          : 'Backup loaded but no missing entries — all data already present';
        if (setCopyToastMessage) {
          setCopyToastMessage(msg);
          setTimeout(() => setCopyToastMessage(''), 6000);
        } else {
          alert(msg);
        }
        setLastAction(msg);
      } catch (err) {
        const msg = `Error loading backup: ${err.message}`;
        if (setCopyToastMessage) {
          setCopyToastMessage(msg);
          setTimeout(() => setCopyToastMessage(''), 6000);
        } else {
          alert(msg);
        }
        setLastAction(msg);
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

  // Shared styles
  const sectionHeader = (color = '#8b5cf6') => ({
    marginBottom: '10px', marginTop: '28px', paddingLeft: '4px',
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  const sectionLabel = (color = '#8b5cf6') => ({
    color, fontSize: '12px', fontWeight: '600', letterSpacing: '1px',
  });
  const card = {
    background: 'rgba(15, 17, 21, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '12px',
    marginBottom: '12px',
    overflow: 'hidden',
  };
  const iconCircle = (bg = 'rgba(99, 102, 241, 0.15)') => ({
    width: '36px', height: '36px', borderRadius: '10px',
    background: bg,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  });
  const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const svgPropsSmall = { ...svgProps, width: 14, height: 14 };

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
          width: '520px',
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

        {/* Mobile Header */}
        {!isDesktop && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
            marginBottom: '24px',
          }}>
            <h2 style={{ color: '#f8fafc', fontSize: '24px', fontWeight: '700', margin: 0 }}>
              Settings
            </h2>
            <button
              onClick={() => {
                setShowSettings(false);
                setShowExport(true);
              }}
              style={{
                position: 'absolute',
                right: 0,
                background: 'none',
                border: '1.5px solid rgba(255,255,255,0.2)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ?
            </button>
          </div>
        )}

        {/* User Account Card */}
        <div style={{ ...card, padding: '20px' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '24px',
                  fontWeight: '600',
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                }}>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (user.displayName || user.email || 'U')[0].toUpperCase()
                  )}
                  <div style={{
                    position: 'absolute',
                    bottom: '1px',
                    left: '1px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    border: '2px solid #0f1115',
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#f8fafc', fontSize: '17px', fontWeight: '600' }}>
                    {user.displayName || user.email?.split('@')[0] || 'User'}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '13px', marginTop: '2px' }}>
                    {user.email}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' }}>
                <button
                  onClick={async () => {
                    if (onForcePush) {
                      await onForcePush();
                      setLastAction('Data pushed to cloud');
                    }
                  }}
                  disabled={syncing}
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '10px 20px',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: syncing ? 'not-allowed' : 'pointer',
                    opacity: syncing ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <svg {...svgPropsSmall} stroke="#fff">
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={handlePullMerge}
                  disabled={pullBusy}
                  title="Fetches cloud and merges with your local data (cloud + local both preserved, newer wins per entry). Snapshot saved automatically."
                  style={{
                    background: 'transparent',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#cbd5e1',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: pullBusy ? 'not-allowed' : 'pointer',
                    opacity: pullBusy ? 0.6 : 1,
                  }}
                >
                  {pullBusy ? 'Pulling…' : 'Pull (merge)'}
                </button>
                <button
                  onClick={() => { refreshSnapshots(); setShowRestore(s => !s); }}
                  title="Restore from a local snapshot taken automatically before each Pull/Push."
                  style={{
                    background: 'transparent',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#cbd5e1',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Restore…
                </button>
                <button
                  onClick={signOut}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '10px 12px',
                    color: '#8b5cf6',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>

              <div style={{
                marginTop: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#64748b',
                fontSize: '13px',
              }}>
                <svg {...svgPropsSmall} stroke="#64748b" strokeWidth={1.5}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {syncing ? (
                  <span>Syncing...</span>
                ) : lastSynced ? (
                  <span>Last synced {lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                ) : (
                  <span>Auto-sync enabled</span>
                )}
              </div>

              {syncError && (
                <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>
                  {syncError}
                </div>
              )}

              {showRestore && (
                <div style={{
                  marginTop: '14px',
                  background: '#0f1115',
                  border: '1px solid #1e293b',
                  borderRadius: '10px',
                  padding: '12px',
                }}>
                  <div style={{ color: '#cbd5e1', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
                    Local snapshots
                  </div>
                  <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '10px' }}>
                    Auto-saved before each Pull/Push and at app boot. Restoring overwrites
                    your current local data with the snapshot, then reloads.
                  </div>
                  {snapshots.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: '12px' }}>No snapshots yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {snapshots.map(s => (
                        <div key={s.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          background: '#0a0c10',
                          borderRadius: '6px',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
                              {new Date(s.ts).toLocaleString()}
                            </div>
                            <div style={{ color: '#64748b', fontSize: '11px' }}>
                              {s.label} · {s.itemCount} items
                            </div>
                          </div>
                          <button
                            onClick={() => handleRestore(s.id)}
                            style={{
                              background: confirmRestoreId === s.id ? '#ef4444' : 'transparent',
                              border: `1px solid ${confirmRestoreId === s.id ? '#ef4444' : '#334155'}`,
                              borderRadius: '6px',
                              padding: '6px 10px',
                              color: confirmRestoreId === s.id ? '#fff' : '#cbd5e1',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {confirmRestoreId === s.id ? 'Confirm?' : 'Restore'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => { saveSnapshot('manual'); refreshSnapshots(); }}
                    style={{
                      marginTop: '8px',
                      background: 'transparent',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      color: '#cbd5e1',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Save snapshot now
                  </button>
                </div>
              )}

              {pullPreview && (
                <div style={{
                  marginTop: '14px',
                  background: '#1f1318',
                  border: '1px solid #7f1d1d',
                  borderRadius: '10px',
                  padding: '12px',
                }}>
                  <div style={{ color: '#fca5a5', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                    Destructive replace preview
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '12px', marginBottom: '8px' }}>
                    Cloud vs local item counts. After Replace, your local data becomes the cloud column.
                    A snapshot is saved first so you can restore.
                  </div>
                  <table style={{ width: '100%', fontSize: '12px', color: '#cbd5e1' }}>
                    <thead style={{ color: '#64748b' }}>
                      <tr><th align="left">domain</th><th align="right">cloud</th><th align="right">local</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(pullPreview).map(([d, v]) => (
                        <tr key={d} style={{ color: v.cloud < v.local ? '#fca5a5' : '#cbd5e1' }}>
                          <td>{d}</td>
                          <td align="right">{v.cloud}</td>
                          <td align="right">{v.local}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button
                      onClick={handlePullReplaceConfirm}
                      disabled={pullBusy}
                      style={{
                        background: '#ef4444',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: pullBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Replace local with cloud
                    </button>
                    <button
                      onClick={() => setPullPreview(null)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        color: '#cbd5e1',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handlePullReplacePreview}
                disabled={pullBusy}
                style={{
                  marginTop: '10px',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: '#64748b',
                  fontSize: '12px',
                  cursor: pullBusy ? 'not-allowed' : 'pointer',
                  opacity: pullBusy ? 0.5 : 1,
                }}
              >
                Replace local with cloud… (destructive)
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

        {/* Garmin Section */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <span style={sectionLabel()}>GARMIN</span>
        </div>
        <div style={{ ...card, padding: '16px' }}>
          {!garminSync.serverAvailable ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6b7280' }} />
                <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: '600' }}>Garmin server not detected</span>
              </div>
              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                Start the garmy server on this machine to sync sleep data.
              </div>
            </>
          ) : !garminSync.authenticated && !garminSync.mfaRequired ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>Server detected</span>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await garminSync.login(garminEmail, garminPassword);
                setGarminPassword('');
              }}>
                <input
                  type="email"
                  placeholder="Garmin email"
                  value={garminEmail}
                  onChange={e => setGarminEmail(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '8px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={garminPassword}
                  onChange={e => setGarminPassword(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '12px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <button type="submit" style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                  fontWeight: '600', cursor: 'pointer',
                }}>
                  Log In
                </button>
              </form>
            </>
          ) : garminSync.mfaRequired ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>MFA code required</span>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await garminSync.submitMfa(garminMfaCode);
                setGarminMfaCode('');
              }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Enter MFA code"
                  value={garminMfaCode}
                  onChange={e => setGarminMfaCode(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '12px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                    background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                    fontWeight: '600', cursor: 'pointer',
                  }}>
                    Submit
                  </button>
                  <button type="button" onClick={() => { garminSync.logout(); setGarminMfaCode(''); }} style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: '#9ca3af', fontSize: '14px', cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>Connected</span>
              </div>
              {garminSync.lastSync && (
                <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
                  Last synced: {(() => {
                    const diff = Math.round((Date.now() - new Date(garminSync.lastSync).getTime()) / 60000);
                    if (diff < 1) return 'just now';
                    if (diff < 60) return `${diff} min ago`;
                    return `${Math.round(diff / 60)}h ago`;
                  })()}
                </div>
              )}
              {garminSync.syncing ? (
                <div style={{ color: '#9ca3af', fontSize: '13px', padding: '10px 0' }}>Syncing...</div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => garminSync.syncNow()} style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                    background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                    fontWeight: '600', cursor: 'pointer',
                  }}>
                    Sync Now
                  </button>
                  <button onClick={() => garminSync.logout()} style={{
                    padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: '#9ca3af', fontSize: '14px', cursor: 'pointer',
                  }}>
                    Disconnect
                  </button>
                </div>
              )}
            </>
          )}
          {garminSync.error && (
            <div style={{
              marginTop: '8px', color: '#f87171', fontSize: '12px',
              background: 'rgba(248, 113, 113, 0.1)', padding: '8px', borderRadius: '6px',
            }}>
              {garminSync.error}
            </div>
          )}
        </div>

        {/* Tracking Preferences */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6">
            <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
            <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
          </svg>
          <span style={sectionLabel()}>TRACKING PREFERENCES</span>
        </div>
        <div style={card}>
          {/* Time format */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(100, 116, 139, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: isDesktop ? 0 : '10px' }}>
              <div style={{ ...iconCircle(), marginRight: '12px', color: '#a5b4fc' }}>
                <svg {...svgProps}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Time format</div>
                <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>How times are displayed in the app</div>
              </div>
              {isDesktop && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {Object.entries(trackingModes).map(([key, mode]) => (
                    <button
                      key={key}
                      onClick={() => setTrackingMode(key)}
                      style={{
                        padding: '8px 16px',
                        background: trackingMode === key ? 'rgba(124, 58, 237, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                        border: trackingMode === key ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: trackingMode === key ? '#fff' : '#94a3b8',
                        fontSize: '13px',
                        fontWeight: trackingMode === key ? '600' : '400',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!isDesktop && (
              <div style={{ display: 'flex', gap: '6px', paddingLeft: '48px' }}>
                {Object.entries(trackingModes).map(([key, mode]) => (
                  <button
                    key={key}
                    onClick={() => setTrackingMode(key)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: trackingMode === key ? 'rgba(124, 58, 237, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                      border: trackingMode === key ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: trackingMode === key ? '#fff' : '#94a3b8',
                      fontSize: '13px',
                      fontWeight: trackingMode === key ? '600' : '400',
                      cursor: 'pointer',
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Default copy range */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(100, 116, 139, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: isDesktop ? 0 : '10px' }}>
              <div style={{ ...iconCircle(), marginRight: '12px', color: '#a5b4fc' }}>
                <svg {...svgProps}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Default copy range</div>
                <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>Default number of days for copy</div>
              </div>
              {isDesktop && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {[1, 7, 14, 30, 60].map(days => (
                    <button
                      key={days}
                      onClick={() => setCopyDays(days)}
                      style={{
                        padding: '8px 12px',
                        minWidth: '36px',
                        background: copyDays === days ? 'rgba(124, 58, 237, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                        border: copyDays === days ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: copyDays === days ? '#fff' : '#94a3b8',
                        fontSize: '13px',
                        fontWeight: copyDays === days ? '600' : '400',
                        cursor: 'pointer',
                      }}
                    >
                      {days}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!isDesktop && (
              <div style={{ display: 'flex', gap: '6px', paddingLeft: '48px' }}>
                {[1, 7, 14, 30, 60].map(days => (
                  <button
                    key={days}
                    onClick={() => setCopyDays(days)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      background: copyDays === days ? 'rgba(124, 58, 237, 0.9)' : 'rgba(255, 255, 255, 0.05)',
                      border: copyDays === days ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: copyDays === days ? '#fff' : '#94a3b8',
                      fontSize: '13px',
                      fontWeight: copyDays === days ? '600' : '400',
                      cursor: 'pointer',
                    }}
                  >
                    {days}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Trend analysis range */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: isDesktop ? 0 : '10px' }}>
              <div style={{ ...iconCircle(), marginRight: '12px', color: '#a5b4fc' }}>
                <svg {...svgProps}>
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Trend analysis range</div>
                <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>Days to analyze for trend arrows</div>
              </div>
              {isDesktop && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {[7, 14, 30].map(days => (
                    <button
                      key={days}
                      onClick={() => setTrendWindow(days)}
                      style={{
                        padding: '8px 16px',
                        background: trendWindow === days ? 'rgba(34, 197, 94, 0.8)' : 'rgba(255, 255, 255, 0.05)',
                        border: trendWindow === days ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: trendWindow === days ? '#fff' : '#94a3b8',
                        fontSize: '13px',
                        fontWeight: trendWindow === days ? '600' : '400',
                        cursor: 'pointer',
                      }}
                    >
                      {days}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!isDesktop && (
              <div style={{ display: 'flex', gap: '6px', paddingLeft: '48px' }}>
                {[7, 14, 30].map(days => (
                  <button
                    key={days}
                    onClick={() => setTrendWindow(days)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      background: trendWindow === days ? 'rgba(34, 197, 94, 0.8)' : 'rgba(255, 255, 255, 0.05)',
                      border: trendWindow === days ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: trendWindow === days ? '#fff' : '#94a3b8',
                      fontSize: '13px',
                      fontWeight: trendWindow === days ? '600' : '400',
                      cursor: 'pointer',
                    }}
                  >
                    {days}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI Shortcuts */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6" fill="none">
            <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/>
            <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/>
          </svg>
          <span style={sectionLabel()}>AI SHORTCUTS</span>
        </div>
        <div style={{ ...card, padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Quick Copy for AI</div>
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>Copy tracking data to clipboard for AI chat</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '6px' }}>
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
                  padding: '10px 0',
                  background: 'rgba(139, 92, 246, 0.2)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  borderRadius: '8px',
                  color: '#c4b5fd',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <svg {...svgPropsSmall} stroke="#c4b5fd" strokeWidth={1.5}>
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>
                </svg>
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
              padding: '4px 0',
              color: '#8b5cf6',
              fontSize: '14px',
              cursor: 'pointer',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            More options
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        {/* Backup & Restore */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
          </svg>
          <span style={sectionLabel()}>BACKUP & RESTORE</span>
        </div>
        <div style={{ ...card, padding: '16px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={backupToFile}
              style={{
                flex: 1,
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '10px',
                padding: '12px',
                color: '#a5b4fc',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <svg {...svgPropsSmall} stroke="#a5b4fc" strokeWidth={1.5}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Save Backup
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1,
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '10px',
                padding: '12px',
                color: '#a5b4fc',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <svg {...svgPropsSmall} stroke="#a5b4fc" strokeWidth={1.5}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
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

        {/* Data Tools */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span style={sectionLabel()}>DATA TOOLS</span>
        </div>
        <div style={card}>
          <button
            onClick={() => { setShowMergeModal(true); setMergeTarget(''); setMergeSource(''); setMergeStrategy('sum'); setConfirmMerge(false); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ ...iconCircle(), color: '#a5b4fc' }}>
              <svg {...svgProps}>
                <rect x="7" y="3" width="10" height="18" rx="2"/><path d="M4 7h3"/><path d="M4 17h3"/><path d="M17 7h3"/><path d="M17 17h3"/>
              </svg>
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Merge Supplements</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Combine duplicate supplements into one</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button
            onClick={() => { setShowRenameModal(true); setRenameTarget(''); setRenameValue(''); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ ...iconCircle(), color: '#a5b4fc' }}>
              <svg {...svgProps}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Rename Supplement</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Change a supplement's display name</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button
            onClick={() => { setShowDeleteModal(true); setDeleteTarget(''); setConfirmDelete(false); haptic('light'); }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ ...iconCircle('rgba(239, 68, 68, 0.15)'), color: '#fca5a5' }}>
              <svg {...svgProps}>
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ color: '#f8fafc', fontSize: '15px', fontWeight: '500' }}>Delete Supplement</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Permanently remove a supplement and all its entries</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        {/* About */}
        <div style={sectionHeader()}>
          <svg {...svgProps} stroke="#8b5cf6">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span style={sectionLabel()}>ABOUT</span>
        </div>
        <div style={{
          ...card,
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#f8fafc', fontSize: '14px', fontWeight: '500' }}>
              v5.4.3
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
              borderRadius: '8px',
              padding: '8px 16px',
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

        {/* Danger Zone */}
        <div style={sectionHeader('#ef4444')}>
          <svg {...svgProps} stroke="#ef4444">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span style={sectionLabel('#ef4444')}>DANGER ZONE</span>
        </div>
        <div style={{
          ...card,
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }}>
          {!confirmClearData ? (
            <button
              onClick={clearAllData}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
                padding: '14px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ ...iconCircle('rgba(239, 68, 68, 0.15)'), color: '#fca5a5' }}>
                <svg {...svgProps}>
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ color: '#fca5a5', fontSize: '15px', fontWeight: '500' }}>Clear All Entries</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Keeps symptoms & supplements</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
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
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ ...iconCircle('rgba(239, 68, 68, 0.15)'), color: '#ef4444' }}>
                <svg {...svgProps}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ color: '#ef4444', fontSize: '15px', fontWeight: '500' }}>Full Reset</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Remove everything</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
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

      {/* Modals */}
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

      </div>
    </div>
  );
}
