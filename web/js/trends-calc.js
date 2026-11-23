// Pure helpers for the Trends page: filtering and the handicap estimate.
// No DOM or Tauri imports, so these can be tested on their own.

// Dates are local-calendar strings "YYYY-MM-DD" (RoundSummary.date is the UTC date from Rust).
// Compare them as plain strings; never parse them with new Date().

export function defaultFilters() {
    return { lastN: null, preset: 'all', dateFrom: null, dateTo: null, courses: [], holes: 'all' };
}

export function isFilterActive(filters) {
    const d = defaultFilters();
    return filters.lastN !== d.lastN
        || filters.preset !== d.preset
        || filters.dateFrom !== d.dateFrom
        || filters.dateTo !== d.dateTo
        || filters.courses.length > 0
        || filters.holes !== d.holes;
}

function pad(n) { return String(n).padStart(2, '0'); }

function daysInMonth(year, month1to12) {
    return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// "This season" = calendar year to date (no southern-hemisphere special case).
// "Last 12 months" = same calendar day one year earlier, clamped (Feb 29 -> Feb 28).
export function presetRange(preset, todayStr) {
    if (preset === 'all' || preset === 'custom') return { from: null, to: null };
    const [y, m, d] = todayStr.split('-').map(Number);
    if (preset === 'season') return { from: `${y}-01-01`, to: todayStr };
    if (preset === '12m') {
        const py = y - 1;
        const pd = Math.min(d, daysInMonth(py, m));
        return { from: `${py}-${pad(m)}-${pad(pd)}`, to: todayStr };
    }
    return { from: null, to: null };
}

export function effectiveDateRange(filters, todayStr) {
    if (filters.preset === 'custom') return { from: filters.dateFrom, to: filters.dateTo };
    return presetRange(filters.preset, todayStr);
}

// Stable key for a course. Prefers the course id; falls back to the name.
export function courseKey(r) {
    return String(r.course_id || r.course_name || '');
}

function passesDate(r, range) {
    if (range.from && r.date < range.from) return false;
    if (range.to && r.date > range.to) return false;
    return true;
}

function passesHoles(r, holes) {
    if (holes === 9) return r.scored_holes === 9;
    if (holes === 18) return r.scored_holes === 18;
    return true;
}

function passesCourse(r, courses) {
    return courses.length === 0 || courses.includes(courseKey(r));
}

// Filters the summaries. Last-N is applied last, to the already filtered, date-sorted set.
export function filterRounds(rounds, filters, todayStr) {
    const range = effectiveDateRange(filters, todayStr);
    let out = rounds
        .filter(r => r.total_score > 0)
        .filter(r => passesDate(r, range) && passesHoles(r, filters.holes) && passesCourse(r, filters.courses))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
    if (filters.lastN) out = out.slice(-filters.lastN);
    return out;
}

// Course list for the picker. Counts ignore the course filter itself (faceted counts),
// so they reflect the current date and hole filters.
export function listCourses(rounds, filters, todayStr) {
    const range = effectiveDateRange(filters, todayStr);
    const counts = new Map();
    rounds
        .filter(r => r.total_score > 0)
        .filter(r => passesDate(r, range) && passesHoles(r, filters.holes))
        .forEach(r => {
            const key = courseKey(r);
            const entry = counts.get(key) ?? { key, name: r.course_name || '—', count: 0 };
            entry.count += 1;
            counts.set(key, entry);
        });
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function round1(x) {
    return Math.round(x * 10) / 10;
}

// Score differential = (score - course rating) * 113 / slope. Null when rating/slope is missing.
// Stored ratings are 18-hole values. For a 9-hole round we estimate the 9-hole rating as half of
// it (no 9-hole rating is stored), otherwise a 9-hole score would look hundreds of strokes low.
export function scoreDifferential(r) {
    if (!(r.course_rating > 0) || !(r.slope > 0) || !(r.total_score > 0)) return null;
    const rating = r.scored_holes === 9 ? r.course_rating / 2 : r.course_rating;
    return (r.total_score - rating) * 113 / r.slope;
}

// How many of the lowest differentials to average (WHS table, "best 8 of the last 20" style).
function bestCount(n) {
    const table = { 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 4,
                    15: 5, 16: 5, 17: 6, 18: 6, 19: 7 };
    if (n >= 20) return 8;
    return table[n] ?? 0;
}

// Handicap estimate for one bucket (18 or 9 scored holes). Expects rounds already filtered by
// date, course and holes (but NOT last-N). This is an estimate, not an official WHS index.
export function computeHandicap(rounds, bucket) {
    const inBucket = rounds.filter(r => r.scored_holes === bucket);
    const diffed = inBucket.map(r => ({ r, diff: scoreDifferential(r) }));
    const excluded = diffed.filter(x => x.diff === null).length;
    const eligibleAll = diffed
        .filter(x => x.diff !== null)
        .sort((a, b) => b.r.date.localeCompare(a.r.date) || String(b.r.time).localeCompare(String(a.r.time)));
    const recent = eligibleAll.slice(0, 20);
    const eligible = recent.length;
    const needed = 3;

    const base = { bucket, index: null, used: [], eligible, excluded, needed };
    if (eligible === 0 && excluded > 0) return { ...base, status: 'norated' };
    if (eligible < needed) return { ...base, status: 'insufficient' };

    const n = bestCount(eligible);
    const bestSet = new Set(
        recent.map((x, i) => ({ i, diff: x.diff }))
            .sort((a, b) => a.diff - b.diff)
            .slice(0, n)
            .map(x => x.i)
    );
    const mean = recent.filter((_, i) => bestSet.has(i)).reduce((s, x) => s + x.diff, 0) / n;
    const used = recent.map((x, i) => ({
        id: x.r.id,
        date: x.r.date,
        course_name: x.r.course_name,
        diff: round1(x.diff),
        counted: bestSet.has(i),
    }));
    return { ...base, status: 'ok', index: round1(mean * 0.96), used, best: n, recent: eligible };
}

// Both indexes: 18-hole and 9-hole are calculated separately and never paired.
export function computeHandicaps(rounds) {
    return { h18: computeHandicap(rounds, 18), h9: computeHandicap(rounds, 9) };
}
