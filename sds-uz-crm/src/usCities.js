// US cities with all of their ZIP codes (50 states + DC) for the From/To fields.
// The data (src/usCities.data.js, ~200 KB gzipped) is generated from GeoNames by
// scripts/build-us-cities.mjs and loaded on first use, outside the main bundle.

export const US_STATE_ABBRS = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KS',
  'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV',
  'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
];

const MAX_RESULTS = 8;

const ABBREVIATIONS = { st: 'saint', ft: 'fort', mt: 'mount' };

// "St. Louis", "st louis" and "Saint Louis, MO" all search the same way (same for
// Ft/Fort and Mt/Mount). A bare trailing "st" stays as is, so typing "st" still
// finds Stockton and Stamford.
export function normalizeCityQuery(text) {
  return text.toLowerCase().replace(/[.,-]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b(st|ft|mt)\b(?= \S)/g, (w) => ABBREVIATIONS[w]);
}

export function cityOption(city, state, zips) {
  const name = state ? `${city}, ${state}` : city;
  return {
    value: name,
    display: name,
    label: zips.length ? `${name} — ${zips[0]}` : name,
    zips,
    searchText: normalizeCityQuery(`${city} ${state}`),
  };
}

// Parses the generated "City|ST|zipzip…" lines (biggest cities first).
export function parseCityData(raw) {
  return raw.split('\n').filter(Boolean).map((line) => {
    const [city, state, zipRun] = line.split('|');
    return cityOption(city, state, zipRun.match(/\d{5}/g) || []);
  });
}

let loading = null;
export function loadUsCityOptions() {
  loading ||= import('./usCities.data.js')
    .then((m) => parseCityData(m.default))
    .catch((e) => { loading = null; throw e; });
  return loading;
}

// Digits search by ZIP prefix and show the matching ZIP; text searches city
// and state, with names that start with the query ranked first.
export function filterCityOptions(options, query) {
  const q = query.trim();
  if (!q) return options.slice(0, MAX_RESULTS);

  if (/^\d+$/.test(q)) {
    const out = [];
    for (const o of options) {
      const zip = o.zips.find((z) => z.startsWith(q));
      if (zip) out.push({ ...o, label: `${o.display} — ${zip}` });
      if (out.length === MAX_RESULTS) break;
    }
    return out;
  }

  const nq = normalizeCityQuery(q);
  const starts = [];
  const contains = [];
  for (const o of options) {
    if (o.searchText.startsWith(nq)) {
      starts.push(o);
      if (starts.length === MAX_RESULTS) break;
    } else if (contains.length < MAX_RESULTS && o.searchText.includes(nq)) {
      contains.push(o);
    }
  }
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}
