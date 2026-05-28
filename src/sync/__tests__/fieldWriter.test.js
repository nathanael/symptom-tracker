import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { writeFieldUpdates } from '../fieldWriter';

// --- Mock window.firebase (modeled on SyncEngine.test.js) ---

function setupFirebaseMock() {
  global.window = global.window || {};
  global.window.firebase = {
    firestore: Object.assign(() => ({}), {
      FieldValue: {
        delete: () => ({ __delete: true }),
        serverTimestamp: () => 'TS',
      },
      FieldPath: class {
        constructor(...segs) {
          this.segments = segs;
        }
      },
    }),
    auth: () => ({
      currentUser: { getIdToken: () => Promise.resolve('tok') },
    }),
  };
}

function makeDocRef(overrides = {}) {
  return {
    path: 'users/UID/months/2026-05',
    update: vi.fn(() => Promise.resolve()),
    set: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('writeFieldUpdates', () => {
  beforeEach(() => {
    setupFirebaseMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('skips network entirely when updates and deletes are both empty', async () => {
    const docRef = makeDocRef();
    const result = await writeFieldUpdates(docRef, {});
    expect(result).toEqual({ ok: true, skipped: true });
    expect(docRef.update).not.toHaveBeenCalled();
    expect(docRef.set).not.toHaveBeenCalled();
  });

  it('writes updates via SDK update() with FieldPath/value varargs', async () => {
    const docRef = makeDocRef();
    const result = await writeFieldUpdates(docRef, {
      updates: { 'entries.2026-05-01': { headache: 3 } },
    });
    expect(result).toEqual({ ok: true, via: 'sdk' });
    expect(docRef.update).toHaveBeenCalledTimes(1);
    const args = docRef.update.mock.calls[0];
    // First arg is a FieldPath with the correct (raw, unquoted) segments
    expect(args[0]).toBeInstanceOf(window.firebase.firestore.FieldPath);
    expect(args[0].segments).toEqual(['entries', '2026-05-01']);
    // Second arg is the value
    expect(args[1]).toEqual({ headache: 3 });
  });

  it('writes deletes via a FieldValue.delete() sentinel for the delete path', async () => {
    const docRef = makeDocRef();
    const result = await writeFieldUpdates(docRef, {
      deletes: ['entries.2026-05-02'],
    });
    expect(result).toEqual({ ok: true, via: 'sdk' });
    const args = docRef.update.mock.calls[0];
    expect(args[0]).toBeInstanceOf(window.firebase.firestore.FieldPath);
    expect(args[0].segments).toEqual(['entries', '2026-05-02']);
    expect(args[1]).toEqual({ __delete: true });
  });

  it('falls back to set(merge) with a nested object on not-found', async () => {
    const docRef = makeDocRef({
      update: vi.fn(() => {
        const err = new Error('missing');
        err.code = 'not-found';
        return Promise.reject(err);
      }),
    });
    const result = await writeFieldUpdates(docRef, {
      updates: { 'entries.k': { v: 1 } },
      deletes: ['entries.gone'],
    });
    expect(result).toEqual({ ok: true, via: 'set-merge' });
    expect(docRef.set).toHaveBeenCalledTimes(1);
    const [setObj, opts] = docRef.set.mock.calls[0];
    expect(setObj).toEqual({ entries: { k: { v: 1 } } });
    expect(opts).toEqual({ merge: true });
  });

  it('falls back to REST PATCH on a generic SDK error', async () => {
    const docRef = makeDocRef({
      update: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));

    const result = await writeFieldUpdates(docRef, {
      updates: { 'entries.k': 5 },
    });
    expect(result).toEqual({ ok: true, via: 'rest' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('users/UID/months/2026-05');
    expect(url).toContain('updateMask.fieldPaths=');
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.fields).toBeDefined();
    expect(body.fields.entries.mapValue.fields.k.integerValue).toBe('5');
  });

  it('falls back to REST when the SDK update times out', async () => {
    const docRef = makeDocRef({
      update: vi.fn(() => new Promise(() => {})), // never resolves
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));

    const result = await writeFieldUpdates(
      docRef,
      { updates: { 'entries.k': 1 } },
      { timeoutMs: 10 }
    );
    expect(result).toEqual({ ok: true, via: 'rest' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns {ok:false} without throwing when REST also fails', async () => {
    const docRef = makeDocRef({
      update: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));

    const result = await writeFieldUpdates(docRef, {
      updates: { 'entries.k': 1 },
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toContain('503');
  });

  it('returns {ok:false} instead of throwing when window.firebase is undefined', async () => {
    const saved = global.window.firebase;
    delete global.window.firebase;
    try {
      const docRef = { path: 'users/u/months/2026-05', update: () => Promise.resolve(), set: () => Promise.resolve() };
      const result = await writeFieldUpdates(docRef, { updates: { 'entries.k': { v: 1 } } });
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
    } finally {
      global.window.firebase = saved;
    }
  });

  it('returns {ok:false} when docRef.update throws synchronously and REST is unavailable', async () => {
    // update throws synchronously; make REST also fail so the terminal result is {ok:false}
    global.fetch = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
    const docRef = {
      path: 'users/u/months/2026-05',
      update: () => { throw new Error('sync boom'); },
      set: () => Promise.resolve(),
    };
    const result = await writeFieldUpdates(docRef, { updates: { 'entries.k': { v: 1 } } });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('falls back to REST when docRef.update throws synchronously (REST ok)', async () => {
    let fetched = false;
    global.fetch = (url, init) => { fetched = true; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); };
    const docRef = {
      path: 'users/u/months/2026-05',
      update: () => { throw new Error('sync boom'); },
      set: () => Promise.resolve(),
    };
    const result = await writeFieldUpdates(docRef, { updates: { 'entries.k': { v: 1 } } });
    expect(result.ok).toBe(true);
    expect(result.via).toBe('rest');
    expect(fetched).toBe(true);
  });
});
