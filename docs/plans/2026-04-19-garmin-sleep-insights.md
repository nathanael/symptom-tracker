# Garmin Sleep Insights Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Garmin sleep analysis view to symptom-tracker's Insights tab, fed by a new `push_to_firestore.py` bridge that mirrors `health.db` into Firestore.

**Architecture:** Local `sync.py` (unchanged) writes to `health.db`. New `push_to_firestore.py` upserts daily docs to `users/{uid}/garminSleep/{YYYY-MM-DD}` using Firebase Admin SDK. In-app, a new `SleepAnalyzer` component reads via a `useGarminSleep` hook (Firestore + localStorage cache), rendered inside `Insights.jsx` behind a `Comparison | Sleep` view switcher.

**Tech Stack:** Python 3 + `firebase-admin` + SQLite (garmin-sleep repo); React 18 + Recharts + Firebase Firestore (symptom-tracker repo); vitest for JS tests; pytest for Python tests.

**Design doc:** `docs/plans/2026-04-19-garmin-sleep-insights-design.md`

**Two repos involved:**
- `~/Dev/garmin-sleep/` — push script lives here
- `~/Dev/symptom-tracker/` — UI and data hook live here

---

## Phase 1 — Push script (garmin-sleep repo)

### Task 1: Set up gitignore and dependencies

**Files:**
- Modify: `~/Dev/garmin-sleep/.gitignore`
- Modify: `~/Dev/garmin-sleep/.venv` (via pip)

**Step 1: Add secrets patterns to `.gitignore`**

Append these lines to `~/Dev/garmin-sleep/.gitignore`:

```
firebase-admin.json
.config.json
```

**Step 2: Install firebase-admin**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/pip install firebase-admin`
Expected: installs `firebase-admin`, `google-cloud-firestore`, deps. No errors.

**Step 3: Verify import works**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -c "import firebase_admin; from firebase_admin import credentials, firestore; print('ok')"`
Expected: prints `ok`.

**Step 4: Commit**

```bash
cd ~/Dev/garmin-sleep
git add .gitignore
git commit -m "chore: ignore firebase-admin.json and .config.json"
```

Note: `firebase-admin` is added to `.venv` only; garmin-sleep has no `requirements.txt` today. Don't create one for this single dep unless the user asks.

---

### Task 2: Write `to_firestore_shape()` mapper with tests

**Files:**
- Create: `~/Dev/garmin-sleep/push_to_firestore.py`
- Create: `~/Dev/garmin-sleep/test_push_to_firestore.py`

**Step 1: Write the failing test**

Create `test_push_to_firestore.py`:

```python
from push_to_firestore import to_firestore_shape


def test_maps_all_fields_present():
    row = {
        "calendarDate": "2026-04-18",
        "deepSleepSeconds": 4200,
        "lightSleepSeconds": 14400,
        "remSleepSeconds": 3900,
        "awakeSleepSeconds": 1800,
        "averageRespiration": 14.2,
        "lowestRespiration": 11.5,
        "avgSleepStress": 18.3,
        "sleep_score": 82,
        "average_spo2": 95,
        "lowest_spo2": 89,
        "hrvOvernight": 48,
        "hrvWeeklyAvg": 45,
        "hrvStatus": "BALANCED",
        "restingHr": 52,
    }
    out = to_firestore_shape(row)
    assert out["date"] == "2026-04-18"
    assert out["deepSleepSeconds"] == 4200
    assert out["sleepScore"] == 82
    assert out["averageSpo2"] == 95
    assert out["lowestSpo2"] == 89
    assert out["hrvStatus"] == "BALANCED"


def test_omits_null_fields():
    row = {
        "calendarDate": "2026-04-18",
        "deepSleepSeconds": 4200,
        "lightSleepSeconds": None,
        "remSleepSeconds": None,
        "awakeSleepSeconds": None,
        "averageRespiration": None,
        "lowestRespiration": None,
        "avgSleepStress": None,
        "sleep_score": None,
        "average_spo2": None,
        "lowest_spo2": None,
        "hrvOvernight": None,
        "hrvWeeklyAvg": None,
        "hrvStatus": None,
        "restingHr": None,
    }
    out = to_firestore_shape(row)
    assert out == {"date": "2026-04-18", "deepSleepSeconds": 4200}
```

**Step 2: Run test to verify it fails**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: FAIL — `ImportError: No module named 'push_to_firestore'` or `AttributeError`.

**Step 3: Write minimal `to_firestore_shape`**

Create `push_to_firestore.py`:

```python
"""Push Garmin sleep rows from health.db to Firestore."""
FIELD_MAP = {
    # sqlite column name -> firestore field name
    "deepSleepSeconds": "deepSleepSeconds",
    "lightSleepSeconds": "lightSleepSeconds",
    "remSleepSeconds": "remSleepSeconds",
    "awakeSleepSeconds": "awakeSleepSeconds",
    "averageRespiration": "averageRespiration",
    "lowestRespiration": "lowestRespiration",
    "avgSleepStress": "avgSleepStress",
    "sleep_score": "sleepScore",
    "average_spo2": "averageSpo2",
    "lowest_spo2": "lowestSpo2",
    "hrvOvernight": "hrvOvernight",
    "hrvWeeklyAvg": "hrvWeeklyAvg",
    "hrvStatus": "hrvStatus",
    "restingHr": "restingHr",
}


def to_firestore_shape(row):
    out = {"date": row["calendarDate"]}
    for src, dst in FIELD_MAP.items():
        v = row.get(src)
        if v is not None:
            out[dst] = v
    return out
```

**Step 4: Run tests to verify pass**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: 2 passed.

**Step 5: Commit**

```bash
cd ~/Dev/garmin-sleep
git add push_to_firestore.py test_push_to_firestore.py
git commit -m "feat: add to_firestore_shape mapper"
```

---

### Task 3: Write the "rows to push" selector with tests

**Files:**
- Modify: `~/Dev/garmin-sleep/push_to_firestore.py`
- Modify: `~/Dev/garmin-sleep/test_push_to_firestore.py`

The selector returns which `calendarDate` rows to upsert given the last pushed date and today's date. It must always re-push the last 7 days (Garmin back-fills HRV and scores).

**Step 1: Write the failing test**

Append to `test_push_to_firestore.py`:

```python
from datetime import date
from push_to_firestore import dates_to_push


def test_first_push_returns_all_available():
    available = ["2026-01-01", "2026-01-02", "2026-04-18"]
    assert dates_to_push(available, last_pushed=None, today=date(2026, 4, 18)) == available


def test_incremental_push_includes_last_7_days_window():
    # last pushed was 2026-04-18; today is 2026-04-19.
    # Cutoff for re-push window = today - 7 = 2026-04-12.
    # We want everything >= cutoff AND everything > last_pushed.
    available = [
        "2026-04-10",  # older than cutoff AND <= last_pushed → skip
        "2026-04-12",  # at cutoff → re-push
        "2026-04-15",  # in re-push window → re-push
        "2026-04-18",  # == last_pushed but in window → re-push
        "2026-04-19",  # new → push
    ]
    result = dates_to_push(available, last_pushed="2026-04-18", today=date(2026, 4, 19))
    assert result == ["2026-04-12", "2026-04-15", "2026-04-18", "2026-04-19"]


def test_no_rows_available_returns_empty():
    assert dates_to_push([], last_pushed="2026-04-18", today=date(2026, 4, 19)) == []
```

**Step 2: Run to verify fail**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: 3 new failures, `ImportError` on `dates_to_push`.

**Step 3: Implement `dates_to_push`**

Append to `push_to_firestore.py`:

```python
from datetime import date, timedelta

REPUSH_WINDOW_DAYS = 7


def dates_to_push(available, last_pushed, today):
    """Return sorted list of YYYY-MM-DD strings to upsert.

    Always pushes the last REPUSH_WINDOW_DAYS days. Also pushes any
    date strictly newer than last_pushed. First-run (last_pushed is None)
    pushes everything.
    """
    if last_pushed is None:
        return sorted(available)
    cutoff = (today - timedelta(days=REPUSH_WINDOW_DAYS)).isoformat()
    keep = [d for d in available if d >= cutoff or d > last_pushed]
    return sorted(set(keep))
```

**Step 4: Run tests**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: all 5 pass.

**Step 5: Commit**

```bash
cd ~/Dev/garmin-sleep
git add push_to_firestore.py test_push_to_firestore.py
git commit -m "feat: add dates_to_push selector with 7-day re-push window"
```

---

### Task 4: Write the health.db query function with a SQLite fixture test

**Files:**
- Modify: `~/Dev/garmin-sleep/push_to_firestore.py`
- Modify: `~/Dev/garmin-sleep/test_push_to_firestore.py`

**Step 1: Write the failing test**

Append to `test_push_to_firestore.py`:

```python
import sqlite3
import tempfile
import os
from push_to_firestore import query_sleep_rows


def _make_fixture_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE daily_health_metrics (
            user_id INTEGER,
            metric_date TEXT,
            deep_sleep_hours REAL,
            light_sleep_hours REAL,
            rem_sleep_hours REAL,
            awake_hours REAL,
            avg_sleep_respiration_value REAL,
            lowest_respiration_value REAL,
            avg_sleep_stress REAL,
            sleep_score INTEGER,
            average_spo2 INTEGER,
            lowest_spo2 INTEGER,
            hrv_last_night_avg INTEGER,
            hrv_weekly_avg INTEGER,
            hrv_status TEXT,
            resting_heart_rate INTEGER
        )
        """
    )
    conn.execute(
        "INSERT INTO daily_health_metrics VALUES "
        "(1,'2026-04-18',1.17,4.0,1.08,0.5,14.2,11.5,18.3,82,95,89,48,45,'BALANCED',52)"
    )
    conn.execute(
        "INSERT INTO daily_health_metrics VALUES "
        "(1,'2026-04-17',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"
    )
    conn.commit()
    conn.close()
    return path


def test_query_sleep_rows_returns_expected_shape():
    db = _make_fixture_db()
    try:
        rows = query_sleep_rows(db)
        by_date = {r["calendarDate"]: r for r in rows}
        # Row with sleep data present
        r = by_date["2026-04-18"]
        assert r["deepSleepSeconds"] == 4212   # 1.17 * 3600
        assert r["sleep_score"] == 82
        # Row without sleep data should be excluded by the WHERE clause
        assert "2026-04-17" not in by_date
    finally:
        os.unlink(db)
```

**Step 2: Run to verify fail**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: 1 failure, `ImportError` on `query_sleep_rows`.

**Step 3: Implement `query_sleep_rows`**

Append to `push_to_firestore.py`:

```python
import sqlite3
from pathlib import Path

SLEEP_QUERY = """
SELECT
    metric_date AS calendarDate,
    CAST(ROUND(deep_sleep_hours * 3600) AS INTEGER) AS deepSleepSeconds,
    CAST(ROUND(light_sleep_hours * 3600) AS INTEGER) AS lightSleepSeconds,
    CAST(ROUND(rem_sleep_hours * 3600) AS INTEGER) AS remSleepSeconds,
    CAST(ROUND(awake_hours * 3600) AS INTEGER) AS awakeSleepSeconds,
    avg_sleep_respiration_value AS averageRespiration,
    lowest_respiration_value AS lowestRespiration,
    avg_sleep_stress AS avgSleepStress,
    sleep_score,
    average_spo2,
    lowest_spo2,
    hrv_last_night_avg AS hrvOvernight,
    hrv_weekly_avg AS hrvWeeklyAvg,
    hrv_status AS hrvStatus,
    resting_heart_rate AS restingHr
FROM daily_health_metrics
WHERE user_id = 1
  AND (deep_sleep_hours IS NOT NULL
       OR light_sleep_hours IS NOT NULL
       OR rem_sleep_hours IS NOT NULL)
ORDER BY metric_date
"""


def query_sleep_rows(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(SLEEP_QUERY).fetchall()]
    finally:
        conn.close()
```

**Step 4: Run tests**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: all pass.

**Step 5: Commit**

```bash
cd ~/Dev/garmin-sleep
git add push_to_firestore.py test_push_to_firestore.py
git commit -m "feat: add query_sleep_rows with health.db fixture test"
```

---

### Task 5: Write the Firestore push glue (`main()`)

**Files:**
- Modify: `~/Dev/garmin-sleep/push_to_firestore.py`

This part talks to a live Firebase project and isn't unit-tested — it's glue. Keep it short.

**Step 1: Write `main()`**

Append to `push_to_firestore.py`:

```python
import json
import sys
from datetime import date

DB_PATH = Path(__file__).parent / "health.db"
CONFIG_PATH = Path(__file__).parent / ".config.json"
SERVICE_ACCOUNT_PATH = Path(__file__).parent / "firebase-admin.json"


def _load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def _init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client(), firestore


def main():
    cfg = _load_config()
    uid = cfg["firebase_uid"]
    client, firestore = _init_firestore()

    meta_ref = (
        client.collection("users").document(uid)
        .collection("garminSleepMeta").document("state")
    )
    meta = meta_ref.get().to_dict() or {}
    last_pushed = meta.get("lastPushedDate")

    rows = query_sleep_rows(DB_PATH)
    by_date = {r["calendarDate"]: r for r in rows}
    targets = dates_to_push(list(by_date.keys()), last_pushed, date.today())
    if not targets:
        print("No rows to push.")
        return

    base = client.collection("users").document(uid).collection("garminSleep")
    batch = client.batch()
    n = 0
    for d in targets:
        shape = to_firestore_shape(by_date[d])
        shape["syncedAt"] = firestore.SERVER_TIMESTAMP
        batch.set(base.document(d), shape, merge=True)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = client.batch()
    batch.commit()

    meta_ref.set({
        "lastPushedDate": max(targets),
        "lastPushedAt": firestore.SERVER_TIMESTAMP,
        "totalDocs": firestore.Increment(n),
    }, merge=True)
    print(f"Pushed {n} doc(s). lastPushedDate={max(targets)}")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        print(f"Missing config: {e}", file=sys.stderr)
        sys.exit(2)
```

**Step 2: Run unit tests still pass**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python -m pytest test_push_to_firestore.py -v`
Expected: all tests still pass (main() doesn't import anything at module scope that breaks tests).

**Step 3: Commit**

```bash
cd ~/Dev/garmin-sleep
git add push_to_firestore.py
git commit -m "feat: add Firestore push main() for garmin sleep data"
```

---

### Task 6: One-time credentials setup (manual)

**Not code. Do these steps, then commit nothing.**

1. Firebase Console → Project Settings → Service Accounts → "Generate new private key". Save as `~/Dev/garmin-sleep/firebase-admin.json`.
2. Get your UID from the symptom-tracker app: open the app signed in, run `localStorage.getItem('firebase_uid')` in devtools OR inspect `auth.currentUser.uid` via the Settings panel (if not surfaced, temporarily log it). Copy the UID.
3. Create `~/Dev/garmin-sleep/.config.json`:

```json
{ "firebase_uid": "PASTE_UID_HERE" }
```

4. Verify both files are ignored: `cd ~/Dev/garmin-sleep && git status` — neither should appear.

---

### Task 7: First-run dry test against real Firestore

**Do not commit anything. Just verify.**

**Step 1: Update Firestore security rules temporarily**

Before running push, update security rules (Task 10 covers this properly). For now the Admin SDK bypasses rules, so you can push even with rules still default.

**Step 2: Run push**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python push_to_firestore.py`
Expected: `Pushed N doc(s). lastPushedDate=<recent date>` where N is roughly the number of days in health.db.

**Step 3: Verify in Firebase Console**

Navigate to Firestore → `users/<your-uid>/garminSleep`. Confirm docs are keyed by `YYYY-MM-DD` with the expected fields.

**Step 4: Run push again**

Run: `cd ~/Dev/garmin-sleep && .venv/bin/python push_to_firestore.py`
Expected: `Pushed 7 doc(s). lastPushedDate=<today-ish>` (re-push window only, no new rows).

---

### Task 8: Wire push into the launchd schedule

**Files:**
- Modify: `~/Dev/garmin-sleep/install-schedule.sh`

**Step 1: Read current schedule script**

Run: `cat ~/Dev/garmin-sleep/install-schedule.sh` to see how it invokes `sync.py`.

**Step 2: Change the scheduled command**

Update the script so the scheduled job runs the equivalent of:

```
.venv/bin/python sync.py && .venv/bin/python push_to_firestore.py
```

Use `&&` so push is skipped if sync fails (prevents stale pushes against incomplete data). The exact form depends on the existing plist template — likely involves joining into a single shell invocation in `ProgramArguments` or wrapping in a small shell script.

If the existing script writes a plist with `ProgramArguments` pointing at `sync.py`, the cleanest approach is:

1. Create `~/Dev/garmin-sleep/run-sync.sh` with:

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
.venv/bin/python sync.py
.venv/bin/python push_to_firestore.py
```

2. `chmod +x run-sync.sh`
3. Update `install-schedule.sh` to point the plist at `run-sync.sh` instead of `sync.py`.

**Step 3: Re-install the schedule**

Run: `bash ~/Dev/garmin-sleep/install-schedule.sh`
Expected: launchd job reloaded without error.

**Step 4: Commit**

```bash
cd ~/Dev/garmin-sleep
git add install-schedule.sh run-sync.sh
git commit -m "chore: run push_to_firestore after sync in scheduled job"
```

---

## Phase 2 — Firestore rules + dependencies (symptom-tracker repo)

### Task 9: Add Recharts dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto)

**Step 1: Install**

Run: `cd ~/Dev/symptom-tracker && npm install recharts`
Expected: `recharts` added to dependencies. Lockfile updates.

**Step 2: Verify import works**

Run: `cd ~/Dev/symptom-tracker && node -e "import('recharts').then(m => console.log(Object.keys(m).slice(0,5)))"` (or just trust npm here; we'll see it fail at component import time).

**Step 3: Commit**

```bash
cd ~/Dev/symptom-tracker
git add package.json package-lock.json
git commit -m "chore: add recharts dependency"
```

---

### Task 10: Add Firestore security rules for garminSleep

**Files:**
- Create or modify: `~/Dev/symptom-tracker/firestore.rules`

**Step 1: Check if rules file exists**

Run: `ls ~/Dev/symptom-tracker/firestore.rules`
If not present, create it; include existing rules for other collections first — check `firebase.json` / Firebase Console for current rules and mirror them.

**Step 2: Add the new rule blocks**

Add inside `match /databases/{database}/documents { ... }`:

```
match /users/{uid}/garminSleep/{day} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
match /users/{uid}/garminSleepMeta/{doc} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

`allow write: if false` ensures only the Admin SDK (which bypasses rules) can write.

**Step 3: Deploy rules**

Run: `cd ~/Dev/symptom-tracker && npx firebase deploy --only firestore:rules`
Expected: rules deployed to `symptoms-dae26`.

**Step 4: Commit**

```bash
cd ~/Dev/symptom-tracker
git add firestore.rules
git commit -m "feat: lock garminSleep collections to owner read-only"
```

---

## Phase 3 — Data hook and pure helpers (symptom-tracker repo)

### Task 11: Cache merge helper with tests

**Files:**
- Create: `src/utils/garminSleepCache.js`
- Create: `src/utils/__tests__/garminSleepCache.test.js`

The merger takes cached days + incoming delta and returns a deduped, sorted-by-date list. Used both on first load (incoming = everything, cache empty) and delta loads.

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { mergeDays } from '../garminSleepCache';

describe('mergeDays', () => {
  it('returns incoming sorted when cache is empty', () => {
    expect(mergeDays([], [{ date: '2026-04-02' }, { date: '2026-04-01' }]))
      .toEqual([{ date: '2026-04-01' }, { date: '2026-04-02' }]);
  });

  it('replaces cached entries with newer incoming ones on same date', () => {
    const cache = [{ date: '2026-04-01', sleepScore: 70 }];
    const incoming = [{ date: '2026-04-01', sleepScore: 82 }];
    expect(mergeDays(cache, incoming)).toEqual([{ date: '2026-04-01', sleepScore: 82 }]);
  });

  it('concatenates non-overlapping days', () => {
    const cache = [{ date: '2026-04-01', sleepScore: 70 }];
    const incoming = [{ date: '2026-04-02', sleepScore: 75 }];
    expect(mergeDays(cache, incoming)).toEqual([
      { date: '2026-04-01', sleepScore: 70 },
      { date: '2026-04-02', sleepScore: 75 },
    ]);
  });
});
```

**Step 2: Run to verify fail**

Run: `cd ~/Dev/symptom-tracker && npx vitest run src/utils/__tests__/garminSleepCache.test.js`
Expected: 3 failures — module not found.

**Step 3: Implement**

Create `src/utils/garminSleepCache.js`:

```js
export function mergeDays(cache, incoming) {
  const byDate = new Map();
  for (const d of cache) byDate.set(d.date, d);
  for (const d of incoming) byDate.set(d.date, d);  // incoming wins on conflict
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
```

**Step 4: Verify pass**

Run: `cd ~/Dev/symptom-tracker && npx vitest run src/utils/__tests__/garminSleepCache.test.js`
Expected: 3 passed.

**Step 5: Commit**

```bash
cd ~/Dev/symptom-tracker
git add src/utils/garminSleepCache.js src/utils/__tests__/garminSleepCache.test.js
git commit -m "feat: add mergeDays helper for sleep cache"
```

---

### Task 12: Aggregation (days → weeks → months) with tests

**Files:**
- Modify: `src/utils/garminSleepCache.js`
- Modify: `src/utils/__tests__/garminSleepCache.test.js`

Reference: `~/Dev/garmin-sleep/garmin-sleep-upgrade/garmin_sleep_analyzer.jsx` has aggregation logic — port the shape but write tests first.

**Step 1: Write failing tests**

Append to the test file:

```js
import { aggregate } from '../garminSleepCache';

describe('aggregate', () => {
  const days = [
    { date: '2026-04-06', sleepScore: 80, remSleepSeconds: 3600 }, // Mon
    { date: '2026-04-07', sleepScore: 82, remSleepSeconds: 3900 },
    { date: '2026-04-08', sleepScore: 84, remSleepSeconds: 4200 },
    { date: '2026-04-13', sleepScore: 70, remSleepSeconds: 3000 }, // next Mon
  ];

  it('passes through in days mode', () => {
    expect(aggregate(days, 'days')).toEqual(days);
  });

  it('buckets by ISO week and averages numeric fields', () => {
    const weeks = aggregate(days, 'weeks');
    expect(weeks).toHaveLength(2);
    expect(weeks[0].date).toBe('2026-04-06');
    expect(weeks[0].sleepScore).toBe(82);       // (80+82+84)/3
    expect(weeks[0].remSleepSeconds).toBe(3900);
    expect(weeks[1].date).toBe('2026-04-13');
    expect(weeks[1].sleepScore).toBe(70);
  });

  it('buckets by month', () => {
    const months = aggregate(days, 'months');
    expect(months).toHaveLength(1);
    expect(months[0].date).toBe('2026-04-01');
    expect(months[0].sleepScore).toBe(79);      // (80+82+84+70)/4 rounded
  });
});
```

**Step 2: Run to verify fail**

Run: `npx vitest run src/utils/__tests__/garminSleepCache.test.js`
Expected: 3 new failures.

**Step 3: Implement**

Append to `src/utils/garminSleepCache.js`:

```js
const NUMERIC_FIELDS = [
  'sleepScore', 'deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds',
  'awakeSleepSeconds', 'averageRespiration', 'lowestRespiration',
  'avgSleepStress', 'averageSpo2', 'lowestSpo2', 'hrvOvernight',
  'hrvWeeklyAvg', 'restingHr',
];

function bucketKey(dateStr, mode) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (mode === 'weeks') {
    // ISO-ish week: back up to Monday
    const day = dt.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }
  if (mode === 'months') {
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }
  return dateStr;
}

export function aggregate(days, mode) {
  if (mode === 'days') return days;
  const buckets = new Map();
  for (const d of days) {
    const key = bucketKey(d.date, mode);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  const out = [];
  for (const [key, rows] of buckets.entries()) {
    const row = { date: key };
    for (const f of NUMERIC_FIELDS) {
      const vals = rows.map(r => r[f]).filter(v => typeof v === 'number');
      if (vals.length) {
        row[f] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
    }
    out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
```

**Step 4: Verify pass**

Run: `npx vitest run src/utils/__tests__/garminSleepCache.test.js`
Expected: all pass.

**Step 5: Commit**

```bash
git add src/utils/garminSleepCache.js src/utils/__tests__/garminSleepCache.test.js
git commit -m "feat: add days/weeks/months aggregation for sleep data"
```

---

### Task 13: Date-range preset helper with tests

**Files:**
- Modify: `src/utils/garminSleepCache.js`
- Modify: `src/utils/__tests__/garminSleepCache.test.js`

**Step 1: Write failing test**

```js
import { rangeForPreset } from '../garminSleepCache';

describe('rangeForPreset', () => {
  const availableMax = '2026-04-19';
  const availableMin = '2024-01-01';

  it('7d returns last 7 days', () => {
    expect(rangeForPreset('7d', availableMin, availableMax))
      .toEqual({ start: '2026-04-13', end: '2026-04-19' });
  });

  it('1y returns last year', () => {
    expect(rangeForPreset('1y', availableMin, availableMax))
      .toEqual({ start: '2025-04-20', end: '2026-04-19' });
  });

  it('all returns full available range', () => {
    expect(rangeForPreset('all', availableMin, availableMax))
      .toEqual({ start: '2024-01-01', end: '2026-04-19' });
  });

  it('clamps start to availableMin', () => {
    expect(rangeForPreset('1y', '2026-03-01', '2026-04-19'))
      .toEqual({ start: '2026-03-01', end: '2026-04-19' });
  });
});
```

**Step 2: Run fail**

Run: `npx vitest run src/utils/__tests__/garminSleepCache.test.js`

**Step 3: Implement**

Append to `garminSleepCache.js`:

```js
const PRESET_DAYS = { '7d': 7, '14d': 14, '30d': 30, '3mo': 90, '6mo': 180, '1y': 365 };

export function rangeForPreset(preset, availableMin, availableMax) {
  if (preset === 'all') return { start: availableMin, end: availableMax };
  const days = PRESET_DAYS[preset];
  if (!days) throw new Error(`Unknown preset: ${preset}`);
  const end = new Date(availableMax + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);
  return {
    start: startStr < availableMin ? availableMin : startStr,
    end: availableMax,
  };
}
```

**Step 4: Pass**

**Step 5: Commit**

```bash
git add src/utils/garminSleepCache.js src/utils/__tests__/garminSleepCache.test.js
git commit -m "feat: add rangeForPreset helper"
```

---

### Task 14: `useGarminSleep` hook with localStorage + Firestore integration test

**Files:**
- Create: `src/hooks/useGarminSleep.js`
- Create: `src/hooks/__tests__/useGarminSleep.test.js`

Mirror the mocking approach in `src/sync/__tests__/SyncEngine.test.js` (localStorage + `window.firebase` mocks).

**Step 1: Write failing tests**

Pattern after `SyncEngine.test.js`. Test cases:
- Hydrates from localStorage immediately (synchronous state after first render).
- With no cache and a mocked Firestore returning two days, state has two days after the promise resolves.
- With a cache (lastPushedAt=T) and Firestore returning one newer doc, state reflects merged list.
- Firestore error falls back to cache without throwing.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGarminSleep } from '../useGarminSleep';

// Mocks: localStorage + window.firebase (copy the shape from SyncEngine.test.js)
// ... see SyncEngine.test.js for the pattern

describe('useGarminSleep', () => {
  beforeEach(() => { localStorage.clear(); });

  it('hydrates synchronously from localStorage cache', () => {
    localStorage.setItem('garminSleepCache', JSON.stringify({
      days: [{ date: '2026-04-18', sleepScore: 80 }],
      lastPushedAt: 1000,
    }));
    const { result } = renderHook(() => useGarminSleep({ uid: 'u1' }));
    expect(result.current.days).toEqual([{ date: '2026-04-18', sleepScore: 80 }]);
  });

  // further cases...
});
```

Note: `@testing-library/react` may not be a dependency yet. Check first: `cat package.json | grep testing-library`. If missing, install `@testing-library/react` as a devDependency and add it to this commit.

**Step 2: Verify fail**

**Step 3: Implement the hook**

Create `src/hooks/useGarminSleep.js`:

```js
import { useEffect, useState, useCallback } from 'react';
import { getFirebaseDb } from '../utils/firebase';
import { mergeDays } from '../utils/garminSleepCache';

const CACHE_KEY = 'garminSleepCache';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { days: [], lastPushedAt: null };
    return JSON.parse(raw);
  } catch {
    return { days: [], lastPushedAt: null };
  }
}

function writeCache(days, lastPushedAt) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ days, lastPushedAt }));
  } catch {}
}

export function useGarminSleep(user) {
  const initial = readCache();
  const [days, setDays] = useState(initial.days);
  const [lastPushedAt, setLastPushedAt] = useState(initial.lastPushedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!user || !user.uid) return;
    const db = getFirebaseDb();
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const base = db.collection('users').doc(user.uid).collection('garminSleep');
      let query = base.orderBy('date');
      if (lastPushedAt) {
        query = base.where('syncedAt', '>', lastPushedAt);
      }
      const snap = await query.get();
      const incoming = snap.docs.map(d => d.data());
      const merged = mergeDays(days, incoming);
      const newestTs = incoming.reduce((acc, d) => {
        const ts = d.syncedAt && d.syncedAt.toMillis ? d.syncedAt.toMillis() : null;
        return ts && (!acc || ts > acc) ? ts : acc;
      }, lastPushedAt);
      setDays(merged);
      setLastPushedAt(newestTs);
      writeCache(merged, newestTs);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [user, days, lastPushedAt]);

  useEffect(() => { refetch(); /* eslint-disable-next-line */ }, [user && user.uid]);

  return { days, loading, error, refetch };
}
```

**Step 4: Pass**

**Step 5: Commit**

```bash
git add src/hooks/useGarminSleep.js src/hooks/__tests__/useGarminSleep.test.js package.json package-lock.json
git commit -m "feat: add useGarminSleep hook with cache + delta fetch"
```

---

## Phase 4 — SleepAnalyzer UI component (symptom-tracker repo)

The source component is `~/Dev/garmin-sleep/garmin-sleep-upgrade/garmin_sleep_analyzer.jsx` (1796 lines). We're porting a subset — roughly 700-900 lines — and restyling from Tailwind to inline styles matching the app.

**Port strategy:** build up the component incrementally rather than pasting the whole source and deleting. Each task adds one capability and is independently reviewable.

### Task 15: Minimal SleepAnalyzer shell

**Files:**
- Create: `src/components/SleepAnalyzer.jsx`

**Step 1: Component with data hook + empty states only**

```jsx
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
```

**Step 2: Verify it renders in isolation**

Temporarily import it in `Insights.jsx` below the ComparisonStudio to eyeball it. Do not commit this wiring.

**Step 3: Commit**

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "feat: add SleepAnalyzer shell with empty/loading states"
```

---

### Task 16: Port the date-range preset bar and aggregation toggle

**Files:**
- Modify: `src/components/SleepAnalyzer.jsx`

Reference in source: look for `setActivePreset`, `setViewMode`, and the JSX around them (search for `'7d'` and `'weeks'`).

- Add state: `preset` (default `'3mo'`), `viewMode` (default `'weeks'`).
- Derive `availableMin`/`availableMax` from `days[0].date` / `days[days.length-1].date`.
- Derive `visible` = `aggregate(slice(days, range), viewMode)` where `range = rangeForPreset(preset, availableMin, availableMax)`.
- Render two button rows: presets + aggregation. Style with inline CSS matching the app (dark segmented-toggle appearance, e.g. look at `DayNightToggle.jsx` for reference).

Commit:

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "feat: add preset + aggregation controls to SleepAnalyzer"
```

---

### Task 17: Port metric definitions and chart switcher

**Files:**
- Modify: `src/components/SleepAnalyzer.jsx`

Reference in source: search for `activeChart` and `CHART_CONFIG` (or the equivalent object with min/max/referenceLines/units).

Define a `METRICS` array with entries like:

```js
const METRICS = [
  { key: 'sleepScore', label: 'Sleep Score', unit: '', refs: [] },
  { key: 'duration',   label: 'Duration', unit: 'min', compute: d => (
      ((d.deepSleepSeconds||0)+(d.lightSleepSeconds||0)+(d.remSleepSeconds||0))/60) },
  { key: 'remSleepSeconds',  label: 'REM',  unit: 'min',
    transform: v => v/60, refs: [{ y: 60, color: '#ef4444' }, { y: 90, color: '#10b981' }] },
  { key: 'deepSleepSeconds', label: 'Deep', unit: 'min',
    transform: v => v/60, refs: [{ y: 60, color: '#f59e0b' }] },
  { key: 'averageRespiration', label: 'Respiration', unit: 'brpm' },
  { key: 'lowestSpo2', label: 'SpO2 (low)', unit: '%' },
  { key: 'avgSleepStress', label: 'Stress', unit: '' },
  { key: 'hrvOvernight', label: 'HRV', unit: 'ms' },
];
```

- Add state: `activeMetric` (default `'sleepScore'`).
- Render a horizontal scrolling tab bar; each button switches `activeMetric`.

Commit:

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "feat: add metric switcher to SleepAnalyzer"
```

---

### Task 18: Render Recharts LineChart for the active metric

**Files:**
- Modify: `src/components/SleepAnalyzer.jsx`

- Import `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`, `ReferenceLine` from `recharts`.
- Transform `visible` into `{ date, value }` for the active metric (apply `transform` and `compute` if present).
- Render a `<ResponsiveContainer height={320}>`.
- Color line `#60a5fa` on dark background; axes `#6b7280`.
- Draw `<ReferenceLine y={ref.y} stroke={ref.color} strokeDasharray="4 4" />` for each configured ref line.

Manual verify: open `/`, switch to Insights, confirm chart renders for each metric.

Commit:

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "feat: render recharts line chart for active sleep metric"
```

---

### Task 19: Port period-vs-period comparison mode

**Files:**
- Modify: `src/components/SleepAnalyzer.jsx`

Reference in source: search for `compareMode`, `period1`, `period2`, `compareType`.

Scope:
- Add state: `compareMode: boolean`, `period1: {start, end}`, `period2: {start, end}`, `compareType: 'previous' | 'year' | 'custom'`.
- Default period2 = last 14 days in data; period1 = the 14 days before that (mirrors source defaults).
- When `compareType` changes to `'previous'` or `'year'`, recompute `period1` from `period2` accordingly. `'custom'` leaves them user-editable via simple `<input type="date">` pickers.
- Render summary stats card: for each metric field, show period1 avg, period2 avg, and delta (`↑` green / `↓` red based on whether higher is better — encode `higherIsBetter` on each metric definition).
- When `compareMode` is on, chart renders two series (`period1` line + `period2` line) aligned by relative index, not absolute date. Use `ComposedChart` or two `Line` components on a shared X.

Manual verify: toggle compare on, confirm deltas look sane against a recent 2-week window.

Commit:

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "feat: add period-vs-period comparison to SleepAnalyzer"
```

---

### Task 20: Polish styling to match app

**Files:**
- Modify: `src/components/SleepAnalyzer.jsx`

- Card panel background matches `ComparisonStudio` (check that file's root styles).
- Button states (active/inactive) match existing segmented toggles — reference `DayNightToggle.jsx`.
- Spacing/padding matches other Insights surfaces.
- Mobile vs. desktop: check `isDesktop` prop and adjust chart height, font sizes, scroll behavior.

Manual verify: Safari desktop + Safari mobile. No horizontal overflow, no clipped headers.

Commit:

```bash
git add src/components/SleepAnalyzer.jsx
git commit -m "style: polish SleepAnalyzer to match app aesthetic"
```

---

## Phase 5 — Insights tab wiring (symptom-tracker repo)

### Task 21: Add view switcher to Insights.jsx

**Files:**
- Modify: `src/components/Insights.jsx`
- Modify: `src/App.jsx` (to thread `user` prop through)

**Step 1: Locate where Insights is rendered in App.jsx**

Run: `grep -n Insights src/App.jsx`. Confirm how `Insights` is imported and which props it gets.

**Step 2: Thread `user` prop**

Update App.jsx to pass `user` to `<Insights user={user} ...>`.

**Step 3: Update Insights.jsx**

```jsx
import { useState, useEffect } from 'react';
import ComparisonStudio from './ComparisonStudio';
import SleepAnalyzer from './SleepAnalyzer';

export default function Insights({ user, entries, symptoms, stackItems, stackEntries, isDesktop, trackingMode, setStackItems }) {
  const [view, setView] = useState(() => localStorage.getItem('insightsView') || 'comparison');
  useEffect(() => { localStorage.setItem('insightsView', view); }, [view]);

  return (
    <div style={isDesktop ? {} : { /* existing mobile styles */ }}>
      <div style={{ maxWidth: isDesktop ? '100%' : '700px', margin: '0 auto' }}>
        <ViewToggle value={view} onChange={setView} />
        {view === 'comparison' ? (
          <ComparisonStudio
            entries={entries} symptoms={symptoms} stackItems={stackItems}
            stackEntries={stackEntries} trackingMode={trackingMode}
            isDesktop={isDesktop} setStackItems={setStackItems}
          />
        ) : (
          <SleepAnalyzer user={user} isDesktop={isDesktop} />
        )}
      </div>
    </div>
  );
}

function ViewToggle({ value, onChange }) {
  // Two-button segmented toggle. Style after DayNightToggle.jsx.
  // ...
}
```

Keep the existing mobile `position: fixed` wrapper block — only add the ViewToggle above the existing contents.

**Step 4: Manual verify**

Run: `npm run dev`. Open Insights. Confirm:
- Toggle switches between Comparison and Sleep.
- Existing Comparison behavior unchanged.
- Selection persists across refresh.
- Sleep view shows the right empty state when not signed in.

**Step 5: Commit**

```bash
git add src/components/Insights.jsx src/App.jsx
git commit -m "feat: add Comparison/Sleep view toggle to Insights tab"
```

---

## Phase 6 — Ship (symptom-tracker repo)

### Task 22: Version bump per CLAUDE.md

**Files:**
- Modify: `package.json` (version)
- Modify: `src/components/Settings.jsx` (version string)
- Modify: `src/components/QuickActionsMenu.jsx` (version string)

Current version is `4.8.3`. Bump to `4.9.0` (minor — user-visible new feature).

Run: `grep -n '"version"' package.json` then update all three files.

Commit:

```bash
git add package.json src/components/Settings.jsx src/components/QuickActionsMenu.jsx
git commit -m "chore: bump version to 4.9.0"
```

---

### Task 23: Build, deploy, smoke-test

**Step 1: Build**

Run: `cd ~/Dev/symptom-tracker && npm run build`
Expected: `dist/` created, no errors.

**Step 2: Deploy**

Run: `npm run deploy`
Expected: `gh-pages` publishes `dist/` to gh-pages branch.

**Step 3: Smoke test production**

Open the deployed app on desktop + mobile. Verify:
- Sign in works.
- Insights → Sleep shows data.
- Each metric chart renders.
- Comparison mode works.
- Refresh preserves view selection.

**Step 4: Push main**

```bash
git push origin main
```

---

## Post-launch checklist

- Run `push_to_firestore.py` manually once and confirm new dates appear in Firestore.
- Let the launchd schedule fire naturally and confirm the wrapper script runs sync → push successfully (check `sync.log` / `sync-error.log`).
- Note any rough edges and file follow-ups:
  - Drag-select statistics popup (deferred from MVP).
  - HRV reference-line thresholds.
  - "Last synced at" indicator in Settings from `garminSleepMeta/state`.
  - D-path: cross-correlating sleep with symptoms inside ComparisonStudio.

---

## Notes for the implementer

- **TDD discipline:** for every pure function (mappers, mergers, aggregators, preset ranges, date math), write the failing test first. For UI component tasks, visual verification is acceptable — React + Recharts don't benefit much from unit tests.
- **Frequent commits:** each task ends in a commit. Don't batch.
- **DRY/YAGNI:** resist porting features we intentionally dropped (upload zone, file manager, drag-select). They're listed as deferred for a reason.
- **No cross-repo commits:** garmin-sleep changes commit to `~/Dev/garmin-sleep`; symptom-tracker changes commit to `~/Dev/symptom-tracker`. Don't mix.
- **Secret hygiene:** `firebase-admin.json` and `.config.json` must never be committed. Verify after every commit with `git status`.
- **Before deploy:** the version bump is mandatory per `CLAUDE.md`. Don't skip.
