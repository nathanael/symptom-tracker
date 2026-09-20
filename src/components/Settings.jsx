import { useState, useRef, useEffect } from 'react';
import './desktopNav.css';
import './settings.css';
import { isDeleted, liveItems, countEntriesFor, daysUntilPurge, RETENTION_DAYS } from '../utils/softDelete';
import { trackingModes, SLEEP_ENABLED } from '../utils/constants';
import { isStandalone, getDateKey, haptic, generateAIDataExport } from '../utils/helpers';
import { mergeSupplements, previewMerge } from '../utils/supplementTools';
import { listSnapshots, restoreSnapshot, saveSnapshot } from '../utils/snapshots';

const chevron = <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>;

// One row pattern: label + description left, control right
function Row({ title, desc, children, stack, danger }) {
  return (
    <div className={`st-row ${stack ? 'stack' : ''} ${danger ? 'danger' : ''}`}>
      <div className="st-txt"><b>{title}</b>{desc && <small>{desc}</small>}</div>
      {children && <div className="st-ctl">{children}</div>}
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="dn-seg sm">
      {options.map(([key, label]) => (
        <button key={key} className={key === value ? 'on' : ''} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  );
}

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
  setLastAction,
  setCopyToastMessage,
  setShowExport,
  setShowSettings,
  isDesktop,
  garminSync,
  onForcePush,
  onRestoreDeleted,
  onDeleteNow,
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


  const [showRestore, setShowRestore] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [pullPreview, setPullPreview] = useState(null);
  const [pullBusy, setPullBusy] = useState(false);
  const [page, setPage] = useState('main'); // mobile drill-in: main | data | recovery
  const [activeSection, setActiveSection] = useState('st-general');
  const bodyRef = useRef(null);
  const railLock = useRef(null);

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
          Object.entries(backup.dailyNotes).forEach(([k, v]) => { if (!merged[k]) { merged[k] = typeof v === 'string' ? { text: v } : v; addedRef.count++; } });
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

  const recentlyDeleted = [
    ...(symptoms || []).filter(isDeleted).map(item => ({ kind: 'symptom', label: 'Symptom', item, entryCount: countEntriesFor(entries, item.id, 'symptomId') })),
    ...(stackItems || []).filter(isDeleted).map(item => ({ kind: 'supplement', label: 'Supplement', item, entryCount: countEntriesFor(stackEntries, item.id, 'itemId') })),
    ...(inputItems || []).filter(isDeleted).map(item => ({ kind: 'factor', label: 'Factor', item, entryCount: countEntriesFor(inputEntries, item.id, 'inputId') })),
  ].map(row => ({ ...row, daysLeft: daysUntilPurge(row.item) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Desktop: the rail highlights the last section whose top has passed a line near the top of the
  // scroll area. A rail click sets the highlight directly and holds it until the smooth scroll settles.
  useEffect(() => {
    const body = bodyRef.current;
    if (!isDesktop || !body) return;
    const onScroll = () => {
      if (railLock.current) {
        clearTimeout(railLock.current);
        railLock.current = setTimeout(() => { railLock.current = null; }, 150);
        return;
      }
      const line = body.getBoundingClientRect().top + 100;
      let current = null;
      body.querySelectorAll('.st-section[id]').forEach((sec) => {
        if (!current || sec.getBoundingClientRect().top <= line) current = sec.id;
      });
      if (current) setActiveSection(current);
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [isDesktop]);

  const goToSection = (id) => {
    setActiveSection(id);
    clearTimeout(railLock.current);
    railLock.current = setTimeout(() => { railLock.current = null; }, 150);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const checkForUpdates = async () => {
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
  };

  const copyForAI = (days) => {
    const data = generateAIDataExport(days, entries, liveItems(symptoms), liveItems(stackItems), stackEntries, dailyNotes, trackingMode, null, liveItems(inputItems), inputEntries);
    navigator.clipboard.writeText(data);
    setCopyToastMessage(`Copied ${days} days of tracking for AI chat`);
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 2250);
  };

  const garminAgo = () => {
    const diff = Math.round((Date.now() - new Date(garminSync.lastSync).getTime()) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff} min ago`;
    return `${Math.round(diff / 60)}h ago`;
  };

  const syncLabel = syncing ? 'Syncing…'
    : syncError ? 'Sync error'
    : lastSynced ? `Synced ${lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Auto-sync on';

  // ---- Sections ----
  const general = (
    <section className="st-section" id="st-general">
      <h3>General</h3><p>How tracking and copying behave.</p>
      <div className="st-group">
        <Row stack title="Tracking mode" desc="Log each symptom once a day, or separately for AM and PM.">
          <Seg options={Object.entries(trackingModes).map(([key, mode]) => [key, mode.label])} value={trackingMode} onChange={setTrackingMode} />
        </Row>
        <Row stack title="Days of data to copy" desc={isDesktop ? 'How many days of data the Copy button in the top bar puts on your clipboard.' : 'How many days of data “Copy for AI” in the ⋯ menu puts on your clipboard.'}>
          <Seg options={[1, 7, 14, 30, 60].map((d) => [d, String(d)])} value={copyDays} onChange={setCopyDays} />
        </Row>
      </div>
    </section>
  );

  const recoveryRows = (
    <>
      <Row stack title="Pull & merge from cloud" desc="Keeps both sides; newer entry wins. A snapshot is saved first.">
        <button className="dn-btn" onClick={handlePullMerge} disabled={pullBusy}>{pullBusy ? 'Pulling…' : 'Pull & merge'}</button>
      </Row>
      <Row stack title="Local snapshots" desc="Saved automatically before every pull or push and at app start. Restoring overwrites local data, then reloads.">
        <button className="dn-btn ghost" onClick={() => { saveSnapshot('manual'); refreshSnapshots(); setShowRestore(true); }}>Save one now</button>
        <button className="dn-btn" onClick={() => { refreshSnapshots(); setShowRestore(s => !s); }}>{showRestore ? 'Hide' : 'Restore…'}</button>
      </Row>
      {showRestore && (snapshots.length === 0 ? (
        <Row title="No snapshots yet" />
      ) : snapshots.map(s => (
        <Row key={s.id} title={new Date(s.ts).toLocaleString()} desc={`${s.label} · ${s.itemCount} items`}>
          <button className={`dn-btn ${confirmRestoreId === s.id ? 'danger solid' : ''}`} onClick={() => handleRestore(s.id)}>
            {confirmRestoreId === s.id ? 'Confirm?' : 'Restore'}
          </button>
        </Row>
      )))}
      <Row stack danger title="Replace local with cloud" desc="Discards anything on this device that isn’t in the cloud. Shows a preview first.">
        <button className="dn-btn danger" onClick={handlePullReplacePreview} disabled={pullBusy}>Preview replace…</button>
      </Row>
      {pullPreview && (
        <div className="st-block">
          <div className="st-txt"><small>Cloud vs local item counts. After Replace, your local data becomes the cloud column. A snapshot is saved first so you can restore.</small></div>
          <table className="st-table">
            <thead><tr><th>domain</th><th className="n">cloud</th><th className="n">local</th></tr></thead>
            <tbody>
              {Object.entries(pullPreview).map(([d, v]) => (
                <tr key={d} className={v.cloud < v.local ? 'loss' : ''}><td>{d}</td><td className="n">{v.cloud}</td><td className="n">{v.local}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="st-ctl">
            <button className="dn-btn danger solid" onClick={handlePullReplaceConfirm} disabled={pullBusy}>Replace local with cloud</button>
            <button className="dn-btn" onClick={() => setPullPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );

  const account = (
    <section className="st-section" id="st-account">
      <h3>Account &amp; sync</h3><p>Your data syncs automatically.</p>
      {firebaseError ? (
        <div className="st-group danger"><Row danger title="Cloud sync unavailable" desc={firebaseError} /></div>
      ) : user ? (
        <>
          <div className="st-group">
            <div className="st-row">
              <span className="st-avatar">{user.photoURL ? <img src={user.photoURL} alt="" /> : (user.displayName || user.email || 'U')[0].toUpperCase()}</span>
              <div className="st-txt">
                <b>{user.displayName || user.email?.split('@')[0] || 'User'}</b>
                <small>{user.email}</small>
                {syncError && <small className="st-err">{syncError}</small>}
              </div>
              <div className="st-ctl"><button className="dn-btn" onClick={signOut}>Sign out</button></div>
            </div>
            {!isDesktop && (
              <button className="st-row link" onClick={() => { refreshSnapshots(); setPage('recovery'); }}>
                <div className="st-txt"><b>Recovery tools</b><small>If this device and the cloud disagree</small></div>
                <span className="st-val">{chevron}</span>
              </button>
            )}
          </div>
          {isDesktop && (
            <details className="st-details">
              <summary>Recovery tools <small>— only if this device and the cloud disagree</small>{chevron}</summary>
              {recoveryRows}
            </details>
          )}
        </>
      ) : (
        <div className="st-group">
          <div className="st-block">
            <div className="st-txt" style={{ marginBottom: 12 }}><b>{isSignUp ? 'Create an account' : 'Sign in'} to sync across devices</b></div>
            <form className="st-form" onSubmit={handleEmailSignIn}>
              <input className="st-input" type="email" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} autoComplete="email" />
              <input className="st-input" type="password" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} autoComplete={isSignUp ? 'new-password' : 'current-password'} />
              <button className="dn-btn primary" style={{ justifyContent: 'center' }} type="submit" disabled={syncing}>
                {syncing ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>
              <button className="dn-btn" style={{ justifyContent: 'center' }} type="button" onClick={signInWithGoogle} disabled={syncing}>Continue with Google</button>
              <button className="st-linkbtn" type="button" onClick={() => { setIsSignUp(!isSignUp); if (setAuthError) setAuthError(null); }}>
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
              </button>
              {!isSignUp && <button className="st-linkbtn" type="button" onClick={handleForgotPassword} disabled={syncing}>Forgot password?</button>}
            </form>
            {authError && <div className="st-err">{authError}</div>}
          </div>
        </div>
      )}
    </section>
  );

  const garminConnected = garminSync.serverAvailable && garminSync.authenticated && !garminSync.mfaRequired;
  const integrations = SLEEP_ENABLED && (
    <section className="st-section" id="st-integrations">
      <h3>Integrations</h3><p>Sources that feed Insights.</p>
      <div className="st-group">
        <Row
          stack={garminConnected}
          title={<>Garmin <span className={`st-tag ${garminConnected ? 'ok' : garminSync.serverAvailable ? 'wait' : ''}`}>
            {garminConnected ? 'Connected' : !garminSync.serverAvailable ? 'Server not detected' : garminSync.mfaRequired ? 'MFA code required' : 'Sign in'}
          </span></>}
          desc={garminConnected
            ? `Sleep data${garminSync.lastSync ? ` · last synced ${garminAgo()}` : ''}`
            : !garminSync.serverAvailable ? 'Start the garmy server on this machine to sync sleep data.' : 'Sleep data'}
        >
          {garminConnected && (garminSync.syncing ? <span className="st-val">Syncing…</span> : (
            <>
              <button className="dn-btn ghost" onClick={() => garminSync.logout()}>Disconnect</button>
              <button className="dn-btn" onClick={() => garminSync.syncNow()}>Sync now</button>
            </>
          ))}
        </Row>
        {garminSync.serverAvailable && !garminSync.authenticated && !garminSync.mfaRequired && (
          <div className="st-block">
            <form className="st-form" onSubmit={async (e) => {
              e.preventDefault();
              await garminSync.login(garminEmail, garminPassword);
              setGarminPassword('');
            }}>
              <input className="st-input" type="email" placeholder="Garmin email" value={garminEmail} onChange={e => setGarminEmail(e.target.value)} />
              <input className="st-input" type="password" placeholder="Password" value={garminPassword} onChange={e => setGarminPassword(e.target.value)} />
              <button className="dn-btn primary" style={{ justifyContent: 'center' }} type="submit">Log In</button>
            </form>
          </div>
        )}
        {garminSync.serverAvailable && garminSync.mfaRequired && (
          <div className="st-block">
            <form className="st-form" onSubmit={async (e) => {
              e.preventDefault();
              await garminSync.submitMfa(garminMfaCode);
              setGarminMfaCode('');
            }}>
              <input className="st-input" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Enter MFA code" value={garminMfaCode} onChange={e => setGarminMfaCode(e.target.value)} autoFocus />
              <div className="st-ctl">
                <button className="dn-btn primary" type="submit">Submit</button>
                <button className="dn-btn" type="button" onClick={() => { garminSync.logout(); setGarminMfaCode(''); }}>Cancel</button>
              </div>
            </form>
          </div>
        )}
        {garminSync.error && <div className="st-block st-err" style={{ marginTop: 0 }}>{garminSync.error}</div>}
      </div>
    </section>
  );

  const dangerRows = (
    <>
      <Row stack danger title="Clear all entries" desc="Keeps your symptom and protocol lists; deletes every logged day and note.">
        {confirmClearData ? (
          <>
            <button className="dn-btn" onClick={() => setConfirmClearData(false)}>Cancel</button>
            <button className="dn-btn danger solid" onClick={clearAllData}>Confirm clear</button>
          </>
        ) : <button className="dn-btn danger" onClick={clearAllData}>Clear entries…</button>}
      </Row>
      <Row stack danger title="Full reset" desc="Removes everything on this device.">
        {confirmFullReset ? (
          <>
            <button className="dn-btn" onClick={() => setConfirmFullReset(false)}>Cancel</button>
            <button className="dn-btn danger solid" onClick={fullReset}>Confirm reset</button>
          </>
        ) : <button className="dn-btn danger" onClick={fullReset}>Reset…</button>}
      </Row>
    </>
  );

  const about = (
    <div className="st-about">
      v6.3.6 · {isStandalone() ? 'Home Screen App' : 'Browser'}<br />
      <button onClick={checkForUpdates} disabled={checkingForUpdates}>{checkingForUpdates ? 'Checking…' : 'Check for updates'}</button>
    </div>
  );

  const data = (
    <section className="st-section" id="st-data">
      <h3>Data</h3><p>Everything that gets data out, brings it back, or removes it.</p>
      <div className="st-sub">Export</div>
      <div className="st-group">
        <Row stack title="Copy for AI chat" desc="Copies a longer range of data right now, formatted for pasting into an AI chat.">
          {[30, 60, 90].map(days => <button key={days} className="dn-btn" onClick={() => copyForAI(days)}>{days}d</button>)}
        </Row>
        <Row title="Custom export" desc="Pick date range, sections and format.">
          <button className="dn-btn" onClick={() => { setShowSettings(false); setShowExport(true); }}>Open export…</button>
        </Row>
        <Row stack title="Backup file" desc="Full JSON backup of everything on this device. Loading merges in anything missing.">
          <button className="dn-btn ghost" onClick={() => fileInputRef.current?.click()}>Load backup…</button>
          <button className="dn-btn" onClick={backupToFile}>Save backup</button>
        </Row>
        <input ref={fileInputRef} type="file" accept="application/json,.json,*/*" onChange={restoreFromFile} style={{ display: 'none' }} />
      </div>
      {recentlyDeleted.length > 0 && (
        <>
          <div className="st-sub">Recently deleted · kept {RETENTION_DAYS} days</div>
          <div className="st-group">
            {recentlyDeleted.map(({ kind, label, item, entryCount, daysLeft }) => (
              <div className="st-row" key={`${kind}-${item.id}`}>
                <div className="st-txt">
                  <b>{item.name}</b>
                  <small className={daysLeft <= 7 ? 'warn' : ''}>{label} · {entryCount} {entryCount === 1 ? 'entry' : 'entries'} · purges in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}</small>
                </div>
                <div className="st-ctl">
                  <button
                    className="dn-btn ghost danger"
                    style={{ borderColor: 'transparent' }}
                    onClick={() => {
                      if (confirm(`Permanently delete “${item.name}” and its ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}? This can't be undone.`)) {
                        onDeleteNow(kind, item);
                        haptic('medium');
                      }
                    }}
                  >
                    Delete now
                  </button>
                  <button className="dn-btn" onClick={() => { onRestoreDeleted(kind, item); haptic('light'); }}>Restore</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="st-sub">Tools</div>
      <div className="st-group">
        <Row title="Merge supplements" desc="Combine two duplicates and their history into one.">
          <button className="dn-btn" onClick={() => { setShowMergeModal(true); setMergeTarget(''); setMergeSource(''); setMergeStrategy('sum'); setConfirmMerge(false); haptic('light'); }}>Merge…</button>
        </Row>
      </div>
      {isDesktop ? (
        <details className="st-details danger">
          <summary>Danger zone{chevron}</summary>
          {dangerRows}
        </details>
      ) : (
        <>
          <div className="st-sub danger">Danger zone</div>
          <div className="st-group danger">{dangerRows}</div>
        </>
      )}
    </section>
  );

  const RAIL = [
    ['st-general', 'General', <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>],
    ['st-account', 'Account & sync', <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>],
    ['st-integrations', 'Integrations', <path d="M9 7V2M15 7V2M6 7h12v5a6 6 0 0 1-12 0zM12 18v4" />],
    ['st-data', 'Data', <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>],
  ].filter(([id]) => SLEEP_ENABLED || id !== 'st-integrations');
  const pageTitle = { main: 'Settings', data: 'Data', recovery: 'Recovery tools' }[page];
  const onBack = () => (isDesktop || page === 'main' ? setShowSettings(false) : setPage('main'));

  return (
    <div className={`st ${isDesktop ? 'desktop' : 'mobile'}`}>
      {/* Scope left, status + the one primary right */}
      <div className="st-bar">
        <div className="dn-wrap">
          <button className="st-back" aria-label="Back" onClick={onBack}><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
          <h2>{isDesktop ? 'Settings' : pageTitle}</h2>
          {user && !firebaseError && page === 'main' && (
            <>
              <span className={`st-status ${syncing ? 'busy' : syncError ? 'err' : ''}`}><i />{syncLabel}</span>
              <button
                className="dn-btn primary"
                disabled={syncing}
                onClick={async () => {
                  if (onForcePush) {
                    await onForcePush();
                    setLastAction('Data pushed to cloud');
                  }
                }}
              >
                Sync now
              </button>
            </>
          )}
        </div>
      </div>

      <div className="st-body" ref={bodyRef}>
        <div className="st-grid">
          {isDesktop ? (
            <>
              <nav className="st-rail">
                {RAIL.map(([id, label, icon]) => (
                  <button key={id} className={activeSection === id ? 'on' : ''} onClick={() => goToSection(id)}>
                    <svg viewBox="0 0 24 24">{icon}</svg>{label}
                  </button>
                ))}
                {about}
              </nav>
              <div>{general}{account}{integrations}{data}</div>
            </>
          ) : page === 'main' ? (
            <>
              {account}{general}{integrations}
              <section className="st-section">
                <h3>Data</h3>
                <div className="st-group">
                  <button className="st-row link" onClick={() => setPage('data')}>
                    <div className="st-txt"><b>Export, backups &amp; deleted items</b></div>
                    <span className="st-val">{recentlyDeleted.length > 0 && `${recentlyDeleted.length} deleted`}{chevron}</span>
                  </button>
                </div>
              </section>
            </>
          ) : page === 'data' ? (
            <>{data}{about}</>
          ) : (
            <section className="st-section" style={{ paddingTop: 12 }}><div className="st-group">{recoveryRows}</div></section>
          )}
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
    </div>
  );
}
