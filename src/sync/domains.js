// Central sync domain configuration.
//
// The nine sync domains, each carrying its canonical localStorage key, data
// kind, and sharding strategy. No other module should hardcode domain lists or
// storage keys — derive everything from here.
//
// kind:     'map'     → object {key:value} where key starts YYYY-MM-DD
//           'idArray' → array of {id, ...} records (or small id array)
//           'scalar'  → single value
// sharding: 'month'       → split across per-month documents
//           'definitions' → stored in the single definitions document

export const DOMAINS = {
  entries:        { storageKey: 'symptomTracker_entries',     kind: 'map',     sharding: 'month' },
  stackEntries:   { storageKey: 'symptomTracker_stackEntries', kind: 'map',     sharding: 'month' },
  inputEntries:   { storageKey: 'symptomTracker_inputEntries', kind: 'map',     sharding: 'month' },
  dailyNotes:     { storageKey: 'symptomTracker_notes',        kind: 'map',     sharding: 'month' },
  symptoms:       { storageKey: 'symptomTracker_symptoms',     kind: 'idArray', sharding: 'definitions' },
  stackItems:     { storageKey: 'symptomTracker_stackItems',   kind: 'idArray', sharding: 'definitions' },
  inputItems:     { storageKey: 'symptomTracker_inputItems',   kind: 'idArray', sharding: 'definitions' },
  pinnedSymptoms: { storageKey: 'symptomTracker_pinned',       kind: 'idArray', sharding: 'definitions' },
  trackingMode:   { storageKey: 'symptomTracker_mode',         kind: 'scalar',  sharding: 'definitions' },
};

export const MAP_DOMAINS = Object.keys(DOMAINS).filter(
  (domain) => DOMAINS[domain].sharding === 'month'
);

export const DEFINITION_DOMAINS = Object.keys(DOMAINS).filter(
  (domain) => DOMAINS[domain].sharding === 'definitions'
);

export function storageKeyFor(domain) {
  return DOMAINS[domain].storageKey;
}

export function isMonthSharded(domain) {
  return DOMAINS[domain]?.sharding === 'month';
}
