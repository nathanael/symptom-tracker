// hydrate — assemble Firestore docs back into the flat app shape.
//
// Reverses the sharding done on write: month docs hold per-month maps for the
// map domains; the single definitions doc holds id-keyed maps + scalars. This
// module flattens them into the shape React/localStorage use.
//
// It produces TWO views of the same data:
//   - `domains`: the APP shape — arrays for definition domains, flat maps for
//     map domains, a string for trackingMode.
//   - `shadow`:  the DIFF shape — id-keyed maps for definition domains, flat
//     maps for map domains. This is what the change-diff operates against.
// Both retain the `_t` write-stamp on every record; the app ignores `_t`, and
// keeping it lets diffMapDomain run directly against React state later.

import { idMapToArray } from './definitionShape.js';
import { MAP_DOMAINS } from './domains.js';

// The month-doc field name for daily notes is `notes`, but the app domain is
// `dailyNotes`. Every other map domain shares its field name with its domain.
const MAP_FIELD_FOR_DOMAIN = {
  dailyNotes: 'notes',
};

function fieldForDomain(domain) {
  return MAP_FIELD_FOR_DOMAIN[domain] || domain;
}

// Normalize the monthDocs argument into an iterable of `data` field objects.
// Accepts an array of { id, data } OR an object map { monthId: data }.
function monthDataList(monthDocs) {
  if (Array.isArray(monthDocs)) {
    return monthDocs.map((doc) => (doc && doc.data) || {});
  }
  if (monthDocs && typeof monthDocs === 'object') {
    return Object.keys(monthDocs).map((id) => monthDocs[id] || {});
  }
  return [];
}

export function assembleDomainsFromDocs(definitionsDoc, monthDocs) {
  const defs = (definitionsDoc && typeof definitionsDoc === 'object') ? definitionsDoc : {};
  const datas = monthDataList(monthDocs);

  const domains = {};
  const shadow = {};

  // Map domains: flatten the per-month maps across every month doc.
  for (const domain of MAP_DOMAINS) {
    const field = fieldForDomain(domain);
    const flat = {};
    for (const data of datas) {
      const monthMap = data && data[field];
      if (monthMap && typeof monthMap === 'object') {
        for (const key of Object.keys(monthMap)) {
          flat[key] = monthMap[key];
        }
      }
    }
    domains[domain] = flat;
    shadow[domain] = flat; // same flat map (with _t) for diffing
  }

  // Definition id-array domains: app shape = array, shadow shape = id-map.
  for (const domain of ['symptoms', 'stackItems', 'inputItems']) {
    const idMap = (defs[domain] && typeof defs[domain] === 'object') ? defs[domain] : {};
    domains[domain] = idMapToArray(idMap);
    shadow[domain] = idMap;
  }

  // pinnedSymptoms: plain array in both views.
  const pinned = Array.isArray(defs.pinnedSymptoms) ? defs.pinnedSymptoms : [];
  domains.pinnedSymptoms = pinned;
  shadow.pinnedSymptoms = pinned;

  // trackingMode: unwrap {value,_t} → string; pass plain strings through.
  // Omit entirely when absent so the app can apply its own default.
  if ('trackingMode' in defs && defs.trackingMode != null) {
    const raw = defs.trackingMode;
    const value = (raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw;
    domains.trackingMode = value;
    shadow.trackingMode = raw;
  }

  return { domains, shadow };
}
