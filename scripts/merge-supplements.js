/**
 * Merge Supplements Script
 *
 * Run this in the browser console while logged into the app.
 * Merges multiple supplement items into one, combining doses on the same day.
 *
 * Usage:
 *   1. Open the app in the browser and make sure you're logged in
 *   2. Open the browser console (F12 → Console)
 *   3. Paste this script and press Enter
 *   4. Call mergeSupplement() with your merge config
 *
 * Examples:
 *   // Merge B1 variants into B1 HCL Injectable
 *   await mergeSupplements({
 *     sourceNames: ['B1 HCL', 'B1 HCL SubQ', 'B1 HCL IM'],
 *     targetName: 'B1 HCL Injectable',
 *   });
 *
 *   // Preview only (no changes written)
 *   await mergeSupplements({
 *     sourceNames: ['B1 HCL', 'B1 HCL SubQ', 'B1 HCL IM'],
 *     targetName: 'B1 HCL Injectable',
 *     dryRun: true,
 *   });
 */

window.mergeSupplements = async function({ sourceNames, targetName, sourceIds: sourceIdOverrides, targetId: targetIdOverride, dryRun = false }) {
  // --- Validate environment ---
  const fb = window.firebase;
  if (!fb) throw new Error('Firebase not loaded. Are you on the app page?');
  const user = fb.auth().currentUser;
  if (!user) throw new Error('Not logged in. Sign in first.');

  console.log(`\n🔧 Merge Supplements ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`  Sources: ${(sourceIdOverrides || sourceNames || []).join(', ')}`);
  console.log(`  Target:  ${targetIdOverride || targetName}`);

  // --- Read current Firestore document ---
  const token = await user.getIdToken();
  const projectId = 'symptoms-dae26';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore read failed: ${res.status} ${await res.text()}`);
  const doc = await res.json();

  // --- Parse fields ---
  const parseField = (name) => {
    const field = doc.fields?.[name];
    if (!field) return null;
    if (field.stringValue !== undefined) return JSON.parse(field.stringValue);
    if (field.mapValue) return firestoreToJs(field);
    return null;
  };

  // Simple Firestore REST value → JS converter
  function firestoreToJs(val) {
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return Number(val.integerValue);
    if (val.doubleValue !== undefined) return val.doubleValue;
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.nullValue !== undefined) return null;
    if (val.arrayValue) return (val.arrayValue.values || []).map(firestoreToJs);
    if (val.mapValue) {
      const obj = {};
      for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
        obj[k] = firestoreToJs(v);
      }
      return obj;
    }
    return val;
  }

  function jsToFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(jsToFirestoreValue) } };
    if (typeof val === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        fields[k] = jsToFirestoreValue(v);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  const stackItems = parseField('stackItems');
  const stackEntries = parseField('stackEntries');
  const vItems = Number(doc.fields?._v_stackItems?.integerValue || 0);
  const vEntries = Number(doc.fields?._v_stackEntries?.integerValue || 0);

  if (!stackItems || !stackEntries) {
    throw new Error('Could not read stackItems or stackEntries from Firestore');
  }

  // --- Find source and target items (by ID or name) ---
  const allNames = stackItems.map(i => `${i.name} (${i.id})`);
  const sourceItems = [];

  if (sourceIdOverrides) {
    for (const id of sourceIdOverrides) {
      const item = stackItems.find(i => i.id === id);
      if (!item) {
        console.warn(`  ⚠️  Source ID "${id}" not found.`);
        continue;
      }
      sourceItems.push(item);
    }
  } else {
    for (const name of (sourceNames || [])) {
      const item = stackItems.find(i => i.name === name);
      if (!item) {
        console.warn(`  ⚠️  Source "${name}" not found. Available: ${allNames.join(', ')}`);
        continue;
      }
      sourceItems.push(item);
    }
  }

  const targetItem = targetIdOverride
    ? stackItems.find(i => i.id === targetIdOverride)
    : stackItems.find(i => i.name === targetName);
  if (!targetItem) {
    throw new Error(`Target not found. Available:\n  ${allNames.join('\n  ')}`);
  }

  if (sourceItems.length === 0) {
    throw new Error('No valid source items found. Nothing to merge.');
  }

  const sourceIds = sourceItems.map(i => i.id);
  const targetId = targetItem.id;

  console.log(`\n  Target item ID: ${targetId}`);
  console.log(`  Source item IDs: ${sourceIds.join(', ')}`);

  // --- Merge stackEntries ---
  // Collect all entries by date for source and target items
  const dateMap = new Map(); // date -> { dose, taken, sources }
  let entriesMerged = 0;
  let entriesRemoved = 0;

  for (const [key, entry] of Object.entries(stackEntries)) {
    const entryItemId = entry.itemId || key.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (sourceIds.includes(entryItemId) || entryItemId === targetId) {
      const date = entry.date || key.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!date) continue;

      if (!dateMap.has(date)) {
        dateMap.set(date, { dose: 0, taken: false, sources: [] });
      }
      const d = dateMap.get(date);
      d.dose += (entry.dose || 0);
      d.taken = d.taken || entry.taken;
      d.sources.push({ id: entryItemId, name: sourceItems.find(s => s.id === entryItemId)?.name || targetName, dose: entry.dose });
    }
  }

  // Build new entries
  const newStackEntries = { ...stackEntries };

  // Remove all source and old target entries
  for (const key of Object.keys(newStackEntries)) {
    const entry = newStackEntries[key];
    const entryItemId = entry.itemId || key.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (sourceIds.includes(entryItemId) || entryItemId === targetId) {
      delete newStackEntries[key];
      entriesRemoved++;
    }
  }

  // Add merged entries under target ID
  for (const [date, data] of dateMap) {
    const key = `${date}-${targetId}`;
    newStackEntries[key] = {
      date,
      itemId: targetId,
      dose: data.dose,
      taken: data.taken,
    };
    entriesMerged++;
  }

  // --- Merge stackItems: remove sources, keep target ---
  const newStackItems = stackItems.filter(i => !sourceIds.includes(i.id));

  // --- Summary ---
  console.log(`\n  📊 Summary:`);
  console.log(`    Dates with entries: ${dateMap.size}`);
  console.log(`    Entries removed: ${entriesRemoved}`);
  console.log(`    Merged entries created: ${entriesMerged}`);
  console.log(`    Items removed: ${sourceItems.map(i => i.name).join(', ')}`);
  console.log(`    Items remaining: ${newStackItems.length} (was ${stackItems.length})`);

  // Show some sample merged dates
  const samples = [...dateMap.entries()].filter(([, d]) => d.sources.length > 1).slice(0, 5);
  if (samples.length > 0) {
    console.log(`\n  📋 Sample merged dates (multiple sources on same day):`);
    for (const [date, data] of samples) {
      const parts = data.sources.map(s => `${s.name}: ${s.dose}`).join(' + ');
      console.log(`    ${date}: ${parts} = ${data.dose}`);
    }
  }

  if (dryRun) {
    console.log(`\n  ℹ️  DRY RUN — no changes written. Call again without dryRun: true to apply.`);
    return { dateMap, sourceItems, targetItem, newStackItems, newStackEntries };
  }

  // --- Write to Firestore ---
  const newVItems = vItems + 1000;
  const newVEntries = vEntries + 1000;

  const payload = {
    fields: {
      stackItems: jsToFirestoreValue(JSON.stringify(newStackItems)),
      stackEntries: jsToFirestoreValue(JSON.stringify(newStackEntries)),
      _v_stackItems: jsToFirestoreValue(newVItems),
      _v_stackEntries: jsToFirestoreValue(newVEntries),
      version: jsToFirestoreValue('4.0'),
    },
  };

  // Use updateMask so we only touch these fields
  const updateMask = Object.keys(payload.fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const writeRes = await fetch(`${url}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!writeRes.ok) {
    throw new Error(`Firestore write failed: ${writeRes.status} ${await writeRes.text()}`);
  }

  console.log(`\n  ✅ Firestore updated successfully!`);
  console.log(`  Version vectors bumped: stackItems ${vItems} → ${newVItems}, stackEntries ${vEntries} → ${newVEntries}`);
  console.log(`\n  ⚠️  Next steps:`);
  console.log(`    1. Clear localStorage: localStorage.removeItem('symptomTracker_stackItems'); localStorage.removeItem('symptomTracker_stackEntries');`);
  console.log(`    2. Reload the page: location.reload()`);
  console.log(`    3. Do NOT use "Force Push to Cloud" — it would overwrite the merge!`);

  return { success: true, dateMap, entriesMerged, entriesRemoved };
}
