import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { defaultFilters, isFilterActive, effectiveDateRange, courseKey, filterRounds, listCourses, computeHandicaps } from './trends-calc.js';
import { buildInsightsCard, buildInsightsText, generateInsights } from './nlg-engine.js';
import { openCoachingModal } from './coaching-panel.js';
import { t, getLang, setLang } from './i18n.js';
import maplibregl from 'maplibre-gl';

const PAGE_SIZE = 10;

const state = {
    rounds: [],
    activeId: null,
    activeTab: 'overview',
    activeView: 'detail',   // 'detail' | 'trends'
    searchTerm: '',
    syncOffset: 0,
    syncing: false,
    activeRound: null,
    settings: null,         // { player_name, device_source }
    platform: 'unknown',    // "macos" | "windows" | "linux"
    isAppleSilicon: false,
};

// ── Tauri commands ───────────────────────────────────────────────────────────

async function syncRounds(count, offset) {
    return invoke('sync_rounds', { count, offset });
}

async function getAllRounds() {
    return invoke('get_all_rounds');
}

async function getRoundDetail(id) {
    return invoke('get_round_detail', { id });
}

async function getAllRoundsLight() {
    return invoke('get_all_rounds_light');
}

async function getStoreStats() {
    return invoke('get_store_stats');
}

async function getSettings() {
    return invoke('get_settings');
}

async function saveSettings(settings) {
    return invoke('save_settings', { settings });
}

async function syncAppleRounds() {
    return invoke('sync_apple_rounds');
}

async function syncAndroidRounds() {
    return invoke('sync_android_rounds');
}

async function syncMobileWifi(host) {
    return invoke('sync_mobile_wifi', { host: host ?? null });
}

async function getPlatform() {
    return invoke('get_platform');
}

async function getIsAppleSilicon() {
    return invoke('get_is_apple_silicon');
}

async function getAppVersion() {
    return invoke('get_app_version');
}

async function deleteRound(id) {
    return invoke('delete_round', { id });
}

async function updateRoundHoles(id, holes) {
    return invoke('update_round_holes', { id, holes });
}

async function gdriveStatus() {
    return invoke('gdrive_get_status');
}

async function gdriveSetConfig(clientId, clientSecret) {
    return invoke('gdrive_set_config', { clientId, clientSecret: clientSecret || null });
}

async function gdriveConnect() {
    return invoke('gdrive_connect');
}

async function gdriveDisconnect() {
    return invoke('gdrive_disconnect');
}

async function gdriveExport(name) {
    return invoke('gdrive_export_rounds', { name });
}

async function gdriveListBackups() {
    return invoke('gdrive_list_backups');
}

async function gdriveImport(fileId, overwrite) {
    return invoke('gdrive_import_rounds', { fileId, overwrite: !!overwrite });
}

async function exportRoundsFile() {
    return invoke('export_rounds_file');
}

async function importRoundsFile(overwrite) {
    return invoke('import_rounds_file', { overwrite: !!overwrite });
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm z-50 ${
        isError ? 'bg-red-700' : 'bg-gray-800'} text-white`;
    el.style.zIndex = '300';   // above modal overlays (z-100) and dialogs (z-200)
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3500);
}

function scoreClass(overPar) {
    if (overPar <= -1) return 'score-under';
    if (overPar === 0) return 'score-even';
    if (overPar <= 2)  return 'score-bogey';
    return 'score-over';
}

function holeRowClass(score, par) {
    const d = score - par;
    if (d <= -2) return 'hole-eagle';
    if (d === -1) return 'hole-birdie';
    if (d === 0)  return 'hole-par';
    if (d === 1)  return 'hole-bogey';
    return 'hole-double';
}

function overParStr(v) {
    if (v === 0) return 'E';
    return v > 0 ? `+${v}` : `${v}`;
}

function fmtAlt(min, max) {
    if (min == null || max == null) return null;
    return `${Math.round(min * 3.28084)}–${Math.round(max * 3.28084)} ft`;
}

function mToFt(m) { return Math.round(m * 3.28084); }

function fmtTempo(ratio) {
    if (ratio == null) return null;
    return `${ratio.toFixed(1)}:1`;
}

// ── Rounds list ──────────────────────────────────────────────────────────────

function renderRoundsList() {
    const list = document.getElementById('rounds-list');
    const filtered = state.rounds.filter(r =>
        !state.searchTerm ||
        r.course_name.toLowerCase().includes(state.searchTerm) ||
        r.date.includes(state.searchTerm)
    );

    const items = filtered.map(r => {
        const alt   = fmtAlt(r.min_altitude_meters, r.max_altitude_meters);
        const tempo = fmtTempo(r.avg_swing_tempo);
        return `
        <div class="round-item ${r.id === state.activeId ? 'active' : ''}" data-id="${r.id}">
            <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm text-gray-800 truncate">${r.source === 'apple' ? '📱 ' : r.source === 'android' ? '🤖 ' : '⌚ '}${r.course_name || 'Unknown Course'}</div>
                    <div class="text-xs text-gray-500">${r.date} · ${r.holes_played}H · ${r.duration_minutes}min</div>
                </div>
                <div class="ml-2 flex flex-col items-center">
                    <div class="score-badge ${scoreClass(r.score_over_par)}">${r.total_score || '—'}</div>
                    <div class="text-xs text-gray-500 mt-0.5">${r.total_score ? overParStr(r.score_over_par) : ''}</div>
                </div>
            </div>
            ${r.total_score ? `
            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>${r.total_putts}p</span>
                <span>${r.gir}/${r.holes_played} GIR</span>
                <span>${r.avg_heart_rate || '—'} bpm</span>
                ${alt   ? `<span>${alt}</span>` : ''}
                ${tempo ? `<span>Tempo ${tempo}</span>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');

    const moreBtn = `
        <button id="load-more-btn"
            class="w-full mt-2 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition">
            ${t('rounds.loadmore')}
        </button>`;

    list.innerHTML = filtered.length === 0
        ? `<p class="text-gray-400 text-sm text-center mt-8">${state.rounds.length === 0 ? t('rounds.empty') : t('rounds.notfound')}</p>`
        : items + moreBtn;

    list.querySelectorAll('.round-item').forEach(el => {
        el.addEventListener('click', () => loadDetail(el.dataset.id));
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showDeleteMenu(e, el.dataset.id);
        });
    });

    document.getElementById('load-more-btn')?.addEventListener('click', handleLoadMore);
}

// ── Context menu (delete) ────────────────────────────────────────────────────

function showDeleteMenu(e, roundId) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.className = 'fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.innerHTML = `<button class="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600">${t('ctx.delete')}</button>`;
    document.body.appendChild(menu);
    menu.querySelector('button').addEventListener('click', () => {
        removeContextMenu();
        confirmDeleteRound(roundId);
    });
    setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
}

function removeContextMenu() {
    document.getElementById('ctx-menu')?.remove();
}

function confirmDeleteRound(roundId) {
    const r = state.rounds.find(r => r.id === roundId);
    const name = r?.course_name || 'this round';
    const modal = document.getElementById('setup-modal');
    modal.innerHTML = `
    <div class="modal-card" style="max-width:360px">
        <div class="text-center mb-4">
            <div class="text-3xl mb-2">🗑️</div>
            <h2 class="text-lg font-bold text-gray-800">${t('delete.title')}</h2>
            <p class="text-sm text-gray-500 mt-2">${t('delete.msg', { name })}</p>
        </div>
        <div class="flex gap-3">
            <button id="del-cancel" class="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">${t('delete.cancel')}</button>
            <button id="del-confirm" class="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">${t('delete.confirm')}</button>
        </div>
    </div>`;
    modal.classList.remove('hidden');
    modal.querySelector('#del-cancel').addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('#del-confirm').addEventListener('click', async () => {
        modal.classList.add('hidden');
        try {
            await deleteRound(roundId);
            state.rounds = state.rounds.filter(r => r.id !== roundId);
            if (state.activeId === roundId) {
                state.activeId = null;
                state.activeRound = null;
                document.getElementById('detail-content').classList.add('hidden');
                document.getElementById('detail-empty').classList.remove('hidden');
            }
            renderRoundsList();
            updateStats();
            toast(t('toast.deleted'));
        } catch (e) {
            toast(t('toast.deletefail', { err: e }), true);
        }
    });
}

// ── Round detail ─────────────────────────────────────────────────────────────

async function loadDetail(id) {
    if (!(await confirmLeaveShotMapEdit())) return;
    state.activeView = 'detail';

    // If same round, just switch tab rendering — no re-fetch
    if (state.activeRound?.id === id) {
        renderDetailTabs();
        return;
    }

    state.activeId    = id;
    state.activeTab   = 'overview';
    state.activeRound = null;
    renderRoundsList();

    const content = document.getElementById('detail-content');
    const empty   = document.getElementById('detail-empty');
    content.classList.remove('hidden');
    empty.classList.add('hidden');

    // Show tab bar immediately with a loading placeholder in the content area
    content.innerHTML = `
        <div class="flex border-b bg-white sticky top-0 z-10 pt-4 mb-4">
            <button class="detail-tab active" data-tab="overview">Overview</button>
            <button class="detail-tab" data-tab="shotmap">Shot Map</button>
            <button class="detail-tab" data-tab="stats">Club Performances</button>
        </div>
        <div class="text-center text-gray-400 py-12">Loading...</div>`;

    try {
        const [round, _patterns, _feedback] = await Promise.all([
            getRoundDetail(id),
            invoke('infer_patterns', { id }).catch(() => null),
            invoke('get_round_feedback', { roundId: id }).catch(() => ({})),
        ]);
        if (!round) { content.innerHTML = '<p class="text-red-500">Round not found.</p>'; return; }
        round._patterns = _patterns;
        round._feedback = _feedback ?? {};
        state.activeRound = round;
        renderDetailTabs();
    } catch (e) {
        content.innerHTML = `<p class="text-red-500">Error: ${e}</p>`;
    }
}

function renderDetailTabs() {
    const round   = state.activeRound;
    const content = document.getElementById('detail-content');
    if (!round) {
        console.log('No round');
        return;
    }

    const sc = round.scorecard;
    const dt = new Date((round.start_ts + 631065600) * 1000);
    const locale = getLang() === 'ko' ? 'ko-KR' : 'en-US';
    const dateStr = dt.toLocaleDateString(locale, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const timeStr = dt.toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit' });

    const tabs = [
        { id: 'overview', label: t('tab.overview') },
        { id: 'shotmap',  label: t('tab.shotmap') },
        { id: 'stats',    label: t('tab.stats') },
        { id: 'sg',       label: t('tab.sg') },
    ];

    const tabBar = `
    <div class="flex items-center border-b bg-white sticky top-0 z-10 pt-4 mb-4">
        <div class="flex flex-1">
        ${tabs.map(t => `
        <button class="detail-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
            ${t.label}
        </button>`).join('')}
        </div>
        <button id="ask-ai-btn"
            class="mr-4 mb-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-300
                   text-purple-700 hover:bg-purple-50 transition flex items-center gap-1.5">
            <span>✨</span> ${t('btn.askai')}
        </button>
    </div>`;

    let tabContent = '';
    if (state.activeTab === 'overview') {
        tabContent = `
            ${buildHeader(round, sc, dateStr, timeStr)}
            ${sc ? buildScorecard(sc) : ''}
            ${buildHealth(round)}
            ${buildHrZones(round)}`;
    } else if (state.activeTab === 'shotmap') {
        console.log('Building shotmap');
        tabContent = buildShotMap(round);
    } else if (state.activeTab === 'stats') {
        console.log('Building stats');
        tabContent = `<div id="course-stats">${buildCourseStats(round)}</div>`;
    } else if (state.activeTab === 'sg') {
        console.log('Building sg');
        tabContent = buildStrokesGainedTab(round);
    }

    content.innerHTML = tabBar + `<div class="space-y-6 pb-6">${tabContent}</div>`;

    // Wire tab buttons — no re-fetch, just re-render
    content.querySelectorAll('.detail-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (state.activeTab === btn.dataset.tab) return;
            if (!(await confirmLeaveShotMapEdit())) return;
            state.activeTab = btn.dataset.tab;
            renderDetailTabs();
        });
    });


    // Post-render hooks
    if (state.activeTab === 'overview') {
        // no chart in overview
    } else if (state.activeTab === 'sg') {
        // coaching panel is a modal, no inline init needed
    } else if (state.activeTab === 'shotmap') {
        requestAnimationFrame(() => renderShotMap(round));
    } else if (state.activeTab === 'stats') {
        requestAnimationFrame(() => renderCourseStatsAsync(round));
    }
}

function buildHeader(round, sc, dateStr, timeStr) {
    const alt   = fmtAlt(round.min_altitude_meters, round.max_altitude_meters);
    const tempo = fmtTempo(round.avg_swing_tempo);
    // Use scored_par (holes played) not total_par (full course)
    const parMap    = sc ? Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h])) : {};
    const scoredPar = sc ? sc.hole_scores.reduce((s, hs) => s + (parMap[hs.hole_number]?.par ?? 0), 0) : 0;
    const overPar   = sc ? sc.total_score - scoredPar : 0;
    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <div class="flex items-start justify-between">
            <div>
                <h2 class="text-2xl font-bold text-gray-800">${sc?.course_name || 'Golf Round'}</h2>
                <p class="text-gray-500 mt-1">${dateStr} · ${timeStr}</p>
                ${sc ? `<p class="text-sm text-gray-400 mt-0.5">${sc.tee_color} Tees · Rating ${sc.course_rating} · Slope ${sc.slope}</p>` : ''}
            </div>
            ${sc ? `
            <div class="text-center">
                <div class="score-badge ${scoreClass(overPar)} w-16 h-16 text-2xl">${sc.total_score}</div>
                <div class="text-sm font-medium mt-1 ${overPar > 0 ? 'text-red-600' : 'text-green-600'}">
                    ${overParStr(overPar)}
                </div>
            </div>` : ''}
        </div>
        <div class="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${Math.round(round.duration_seconds / 60)}</div>
                <div class="text-xs text-gray-500">${t('stat.minutes')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${(round.distance_meters / 1000).toFixed(2)}</div>
                <div class="text-xs text-gray-500">${t('stat.kmwalked')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${round.avg_heart_rate || '—'}</div>
                <div class="text-xs text-gray-500">${t('stat.avghr')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${round.calories || '—'}</div>
                <div class="text-xs text-gray-500">${t('stat.calories')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${alt || '—'}</div>
                <div class="text-xs text-gray-500">${t('stat.altitude')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${tempo || '—'}</div>
                <div class="text-xs text-gray-500">${t('stat.avgtempo')}</div>
            </div>
        </div>
        ${round.total_ascent != null ? `
        <div class="mt-3 flex gap-4 text-xs text-gray-500 justify-center">
            <span>${t('stat.ascent', {v: mToFt(round.total_ascent)})}</span>
            <span>${t('stat.descent', {v: mToFt(round.total_descent)})}</span>
        </div>` : ''}
    </div>`;
}

// ── Timeline chart ───────────────────────────────────────────────────────────

let activeChart = null;
let activeHoleMarkers = []; // shared between renderTimelineChart and zoomTimeline
let activeTimelinePts = []; // health samples used in chart (downsampled)
const GARMIN_EPOCH = 631065600;

function buildTimeline(round) {
    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Round Timeline</h3>
        <p class="text-xs text-gray-400 mb-4">Heart rate, altitude and stress over time. Vertical lines mark hole transitions.</p>
        <div class="relative" style="height:260px">
            <canvas id="timeline-chart"></canvas>
        </div>
    </div>`;
}

function renderTimelineChart(round) {
    const canvas = document.getElementById('timeline-chart');
    if (!canvas) return;
    if (activeChart) { activeChart.destroy(); activeChart = null; }



    // Downsample to max 300 points
    const samples = round.health_timeline;
    const step = Math.max(1, Math.floor(samples.length / 300));
    const pts = samples.filter((_, i) => i % step === 0);
    activeTimelinePts = pts; // store for shot indicator

    const labels     = pts.map(s => {
        const d = new Date((s.timestamp + GARMIN_EPOCH) * 1000);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    });
    const hrData     = pts.map(s => s.heart_rate ?? null);
    const altData    = pts.map(s => s.altitude_meters != null ? +(s.altitude_meters * 3.28084).toFixed(1) : null);
    const stressData = pts.map(s => s.stress_proxy ?? null);

    // Build tempo data — sparse samples mapped onto the health timeline index
    const tempoData = new Array(pts.length).fill(null);
    (round.tempo_timeline ?? []).forEach(t => {
        let closestIdx = 0, closestDiff = Infinity;
        pts.forEach((s, i) => {
            const diff = Math.abs(s.timestamp - t.timestamp);
            if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
        });
        tempoData[closestIdx] = +t.ratio.toFixed(2);
    });

    // Build hole markers and store in shared variable
    activeHoleMarkers = [];
    const sc = round.scorecard;
    if (sc?.hole_scores?.length > 0) {
        const sortedHoles = [...sc.hole_scores].sort((a, b) => a.hole_number - b.hole_number);

        if (round.shots?.length > 0) {
            // Garmin path: match scorecard shots to activity shots by GPS proximity
            let minTimestamp = -Infinity;
            sortedHoles.forEach(hs => {
                if (!hs.shots?.length) return;
                const shotFrom = hs.shots[0].from;
                let best = null, bestDist = Infinity;
                for (const shot of round.shots) {
                    if (!shot.position || shot.timestamp <= minTimestamp) continue;
                    const d = (shot.position.lat - shotFrom.lat) ** 2
                            + (shot.position.lon - shotFrom.lon) ** 2;
                    if (d < bestDist) { bestDist = d; best = shot; }
                }
                if (!best) return;
                minTimestamp = best.timestamp;
                const shotUnix = best.timestamp + GARMIN_EPOCH;
                let closestIdx = 0, closestDiff = Infinity;
                pts.forEach((s, i) => {
                    const diff = Math.abs((s.timestamp + GARMIN_EPOCH) - shotUnix);
                    if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
                });
                activeHoleMarkers.push({ index: closestIdx, label: `H${hs.hole_number}` });
            });
        } else {
            // iPhone path: use scorecard shot timestamps directly
            sortedHoles.forEach(hs => {
                if (!hs.shots?.length) return;
                const ts = hs.shots[0].timestamp;
                if (ts == null) return;
                let closestIdx = 0, closestDiff = Infinity;
                pts.forEach((s, i) => {
                    const diff = Math.abs(s.timestamp - ts);
                    if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
                });
                activeHoleMarkers.push({ index: closestIdx, label: `H${hs.hole_number}` });
            });
        }
    }

    // Inline plugin: hole markers + shot indicator
    let shotIndicatorIdx = null;
    const holeLinePlugin = {
        id: 'holeLines',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            // Hole markers
            activeHoleMarkers.forEach(({ index, label }) => {
                const xPos = x.getPixelForValue(index);
                if (xPos < x.left || xPos > x.right) return;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(xPos, top);
                ctx.lineTo(xPos, bottom);
                ctx.strokeStyle = 'rgba(99,102,241,0.55)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '9px sans-serif';
                ctx.fillStyle = '#6366f1';
                ctx.textAlign = 'center';
                ctx.fillText(label, xPos, top + 10);
                ctx.restore();
            });
            // Shot indicator — yellow diamond
            if (shotIndicatorIdx !== null) {
                const xPos = x.getPixelForValue(shotIndicatorIdx);
                console.log('Drawing shot indicator, shotIndicatorIdx:', shotIndicatorIdx, 'xPos:', xPos, 'x.left:', x.left, 'x.right:', x.right);
                if (xPos >= x.left && xPos <= x.right) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xPos, top);
                    ctx.lineTo(xPos, bottom);
                    ctx.strokeStyle = 'rgba(234,179,8,0.9)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.fillStyle = 'rgb(234,179,8)';
                    ctx.beginPath();
                    ctx.moveTo(xPos,     top + 4);
                    ctx.lineTo(xPos + 5, top + 9);
                    ctx.lineTo(xPos,     top + 14);
                    ctx.lineTo(xPos - 5, top + 9);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                } else {
                    console.log('xPos out of bounds!');
                }
            }
        }
    };
    // Expose so showShotOnTimeline can trigger a redraw
    window._setShotIndicator = (idx) => {
        console.log('_setShotIndicator called with idx:', idx, 'activeChart exists:', !!activeChart);
        shotIndicatorIdx = idx;
        if (activeChart) {
            console.log('Calling activeChart.update(), shotIndicatorIdx is now:', shotIndicatorIdx);
            activeChart.update('none'); // 'none' mode updates plugin hooks without animation
        }
    };

    activeChart = new Chart(canvas, {
        type: 'line',
        plugins: [holeLinePlugin],
        data: {
            labels,
            datasets: [
                {
                    label: 'HR (bpm)',
                    data: hrData,
                    borderColor: 'rgb(239,68,68)',
                    backgroundColor: 'rgba(239,68,68,0.07)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yHr',
                    spanGaps: true,
                },
                {
                    label: 'Altitude (ft)',
                    data: altData,
                    borderColor: 'rgb(59,130,246)',
                    backgroundColor: 'rgba(59,130,246,0.07)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yAlt',
                    spanGaps: true,
                },
                {
                    label: 'Stress',
                    data: stressData,
                    borderColor: 'rgb(249,115,22)',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yHr',
                    borderDash: [4, 2],
                    spanGaps: true,
                },
                {
                    label: 'Tempo (ratio)',
                    data: tempoData,
                    borderColor: 'rgb(16,185,129)',
                    backgroundColor: 'rgb(16,185,129)',
                    borderWidth: 0,
                    pointRadius: tempoData.map(v => v !== null ? 5 : 0),
                    pointStyle: 'circle',
                    showLine: false,
                    yAxisID: 'yTempo',
                    spanGaps: false,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { title: items => items[0].label } },
            },
            scales: {
                x: {
                    type: 'category',
                    title: { display: true, text: 'Time of day', font: { size: 11 } },
                    ticks: { font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 },
                },
                yHr: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'HR / Stress', font: { size: 11 } },
                    ticks: { font: { size: 10 } },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                },
                yAlt: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Altitude (ft)', font: { size: 11 } },
                    ticks: { font: { size: 10 } },
                    grid: { drawOnChartArea: false },
                },
                yTempo: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Tempo', font: { size: 11 } },
                    ticks: { font: { size: 10 }, callback: v => `${v.toFixed(1)}:1` },
                    grid: { drawOnChartArea: false },
                    min: 1.5,
                    max: 6.0,
                },
            }
        }
    });
}

// Show a shot's position on the timeline chart as a yellow indicator.
function showShotOnTimeline(timelineIdx) {
    console.log('showShotOnTimeline called with timelineIdx:', timelineIdx, 'activeTimelinePtsLength:', activeTimelinePts.length);

    if (timelineIdx === undefined || timelineIdx === null || !activeTimelinePts.length) {
        console.log('Skipping: timelineIdx=', timelineIdx, 'pts=', activeTimelinePts.length);
        return;
    }

    // Clamp to valid range
    const validIdx = Math.max(0, Math.min(timelineIdx, activeTimelinePts.length - 1));
    console.log('Setting shot indicator at index:', validIdx);
    if (window._setShotIndicator) window._setShotIndicator(validIdx);
}

function clearShotIndicator() {
    if (window._setShotIndicator) window._setShotIndicator(null);
}

// Zoom the timeline chart to a hole's time window, or reset to full round.
function zoomTimeline(holeFilter) {
    if (!activeChart) return;
    const xScale = activeChart.options.scales.x;

    if (holeFilter === 'all') {
        xScale.min = undefined;
        xScale.max = undefined;
        activeChart.update();
        return;
    }

    const holeNum = parseInt(holeFilter);
    const idx = activeHoleMarkers.findIndex(m => m.label === `H${holeNum}`);
    if (idx === -1) return;

    const startIdx = activeHoleMarkers[idx].index;
    const endIdx = idx + 1 < activeHoleMarkers.length
        ? activeHoleMarkers[idx + 1].index
        : activeChart.data.labels.length - 1;

    const buffer = Math.max(2, Math.round((endIdx - startIdx) * 0.1));
    xScale.min = Math.max(0, startIdx - buffer);
    xScale.max = Math.min(activeChart.data.labels.length - 1, endIdx + buffer);
    activeChart.update();
}

// Totals for a set of holes. Only holes with a recorded score (> 0) count, so unplayed holes add nothing.
function nineTotals(holes, parMap) {
    const played = holes.filter(h => h.score > 0);
    const parOf = h => parMap[h.hole_number]?.par ?? 0;
    const ydsOf = h => parMap[h.hole_number] ? Math.round(parMap[h.hole_number].distance_cm / 91.44) : 0;
    const fwHoles = played.filter(h => parOf(h) !== 3);
    return {
        par: played.reduce((sum, h) => sum + parOf(h), 0),
        score: played.reduce((sum, h) => sum + h.score, 0),
        putts: played.reduce((sum, h) => sum + (h.putts || 0), 0),
        yds: played.reduce((sum, h) => sum + ydsOf(h), 0),
        shots: played.reduce((sum, h) => sum + h.shots.length, 0),
        fwHit: fwHoles.filter(h => h.fairway_hit).length,
        fwEligible: fwHoles.length,
    };
}

function buildScorecard(sc) {
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    const holeRow = hs => {
        const def  = parMap[hs.hole_number];
        const par  = def?.par || 0;
        const dist = def ? Math.round(def.distance_cm / 91.44) : '—';
        const diff = hs.score - par;
        const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
        return `
        <tr class="${holeRowClass(hs.score, par)}">
            <td class="font-medium">${hs.hole_number}</td>
            <td class="text-gray-500">${par}</td>
            <td class="text-gray-400 text-xs">${def?.handicap || '—'}</td>
            <td class="text-gray-400 text-xs">${dist}</td>
            <td class="font-bold">${hs.score} <span class="text-xs font-normal text-gray-500">(${diffStr})</span></td>
            <td>${hs.putts}</td>
            <td>${par === 3 ? '—' : (hs.fairway_hit ? '✓' : '✗')}</td>
            <td class="text-xs text-gray-400">${hs.shots.length}</td>
        </tr>`;
    };

    // Subtotal or total row. `label` is OUT, IN or TOTAL.
    const totalRow = (label, tot) => {
        const over = tot.score - tot.par;
        return `
        <tr class="font-bold bg-gray-50">
            <td>${label}</td>
            <td>${tot.par}</td>
            <td></td>
            <td>${tot.yds}</td>
            <td><span class="${scoreClass(over)}">${tot.score} (${overParStr(over)})</span></td>
            <td>${tot.putts}</td>
            <td>${tot.fwEligible ? `${tot.fwHit}/${tot.fwEligible}` : '—'}</td>
            <td class="text-xs font-normal text-gray-500">${tot.shots}</td>
        </tr>`;
    };

    // One <tbody> per nine: its played holes, then its subtotal. A nine with no played holes is left out.
    const nine = (holes, label) => {
        const played = holes.filter(h => h.score > 0);
        if (!played.length) return '';
        return `<tbody>${played.map(holeRow).join('')}</tbody>
                <tbody>${totalRow(label, nineTotals(played, parMap))}</tbody>`;
    };
    const front = sc.hole_scores.filter(h => h.hole_number <= 9);
    const back  = sc.hole_scores.filter(h => h.hole_number > 9);

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('scorecard.title')}</h3>
        <div class="grid grid-cols-4 gap-4 mb-4 text-center">
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-700">${sc.total_putts}</div>
                <div class="text-xs text-gray-500">${t('scorecard.putts')}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-700">${sc.gir}/${sc.hole_scores.length}</div>
                <div class="text-xs text-gray-500">${t('scorecard.gir')}</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-3">
                <div class="text-xl font-bold text-yellow-700">${sc.fairways_hit}</div>
                <div class="text-xs text-gray-500">${t('scorecard.fairways')}</div>
            </div>
            <div class="bg-purple-50 rounded-lg p-3">
                <div class="text-xl font-bold text-purple-700">${sc.hole_scores.length}</div>
                <div class="text-xs text-gray-500">${t('scorecard.holes')}</div>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="hole-table w-full text-sm">
                <thead>
                    <tr><th>${t('scorecard.hole')}</th><th>${t('scorecard.par')}</th><th>${t('scorecard.hdcp')}</th><th>${t('scorecard.yds')}</th><th>${t('scorecard.score')}</th><th>${t('scorecard.putts')}</th><th>${t('scorecard.fw')}</th><th>${t('scorecard.shots')}</th></tr>
                </thead>
                ${nine(front, t('scorecard.out'))}
                ${nine(back, t('scorecard.in'))}
                <tfoot>
                    ${totalRow(t('scorecard.total'), nineTotals(sc.hole_scores, parMap))}
                </tfoot>
            </table>
        </div>
    </div>`;
}

function buildHealth(round) {
    const bbSamples = round.health_timeline.filter(s => s.body_battery != null).map(s => s.body_battery);
    const bbStart = bbSamples[0];
    const bbEnd   = bbSamples[bbSamples.length - 1];
    const stressSamples = round.health_timeline.filter(s => s.stress_proxy != null && s.stress_proxy > 0).map(s => s.stress_proxy);
    const avgStress  = stressSamples.length ? Math.round(stressSamples.reduce((a,b) => a+b, 0) / stressSamples.length) : null;
    const peakStress = stressSamples.length ? Math.max(...stressSamples) : null;

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('health.title')}</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-xl font-bold text-red-600">${round.avg_heart_rate || '—'} / ${round.max_heart_rate || '—'}</div>
                <div class="text-xs text-gray-500">${t('health.avgmaxhr')}</div>
            </div>
            ${bbStart != null ? `
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${bbStart}% → ${bbEnd}%</div>
                <div class="text-xs text-gray-500">${t('health.bodybattery', {drain: bbStart - bbEnd})}</div>
            </div>` : '<div></div>'}
            ${avgStress != null ? `
            <div class="bg-orange-50 rounded-lg p-3">
                <div class="text-xl font-bold text-orange-600">${avgStress} / ${peakStress}</div>
                <div class="text-xs text-gray-500">${t('health.avgpeakstress')}</div>
            </div>` : '<div></div>'}
        </div>
    </div>`;
}

function buildHrZones(round) {
    const MAX_HR = 185;
    const zones = [
        { name: 'Z1 Recovery',  color: 'bg-blue-300',   min: 0,    max: 0.50 },
        { name: 'Z2 Aerobic',   color: 'bg-green-400',  min: 0.50, max: 0.60 },
        { name: 'Z3 Tempo',     color: 'bg-yellow-400', min: 0.60, max: 0.70 },
        { name: 'Z4 Threshold', color: 'bg-orange-400', min: 0.70, max: 0.80 },
        { name: 'Z5 Anaerobic', color: 'bg-red-500',    min: 0.80, max: 1.00 },
    ];
    const counts = zones.map(z => ({
        ...z,
        count: round.health_timeline.filter(s => {
            if (!s.heart_rate) return false;
            const pct = s.heart_rate / MAX_HR;
            return pct >= z.min && pct < z.max;
        }).length
    }));
    const total = counts.reduce((a, b) => a + b.count, 0);
    if (total === 0) return '';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('hrzones.title')}</h3>
        <div class="space-y-2">
        ${counts.map(z => {
            const pct  = (z.count / total * 100).toFixed(1);
            const mins = Math.round(z.count / 12);
            return `
            <div class="flex items-center gap-3">
                <div class="w-28 text-xs text-gray-600">${z.name}</div>
                <div class="flex-1 bg-gray-100 rounded-full h-2">
                    <div class="${z.color} zone-bar" style="width:${pct}%"></div>
                </div>
                <div class="w-20 text-xs text-gray-500 text-right">${pct}% (~${mins}min)</div>
            </div>`;
        }).join('')}
        </div>
    </div>`;
}

// ── Shot Map ─────────────────────────────────────────────────────────────────

let activeMap = null;
// Fetch lie angles from backend via Tauri command (cached per-location in Rust)
// Samples 4 points ±10 yards in all directions to compute both lateral and longitudinal slope.
async function fetchLieAngles(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return {};

    const OFFSET_M = 9.144; // 10 yards
    const queries = [];

    sc.hole_scores.forEach(hs => {
        hs.shots.forEach((shot, idx) => {
            if (shot.club_category === 'putt') return;
            const bear     = bearing(shot.from, shot.to);
            const left     = offsetPoint(shot.from, bear - 90, OFFSET_M);
            const right    = offsetPoint(shot.from, bear + 90, OFFSET_M);
            const forward  = offsetPoint(shot.from, bear,       OFFSET_M);
            const backward = offsetPoint(shot.from, bear + 180, OFFSET_M);
            queries.push({ key: `${hs.hole_number}-${idx}`, shot, left, right, forward, backward });
        });
    });

    if (!queries.length) return {};

    const allPoints = queries.flatMap(q => [q.left, q.right, q.forward, q.backward]);
    const locations = allPoints.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`);
    const results = {};

    try {
        const elevations = await invoke('fetch_elevations', { locations });

        queries.forEach((q, i) => {
            const leftElev     = elevations[i * 4];
            const rightElev    = elevations[i * 4 + 1];
            const forwardElev  = elevations[i * 4 + 2];
            const backwardElev = elevations[i * 4 + 3];
            if (leftElev != null && rightElev != null && forwardElev != null && backwardElev != null) {
                const lateralDiff      = rightElev - leftElev;       // positive = right is higher (sidehill)
                const longitudinalDiff = forwardElev - backwardElev; // positive = forward is higher (uphill)
                const totalDiff = Math.sqrt(lateralDiff ** 2 + longitudinalDiff ** 2);
                const angle     = Math.atan2(totalDiff, OFFSET_M * 2) * 180 / Math.PI;
                let label;
                if (angle < 1) {
                    label = 'Flat';
                } else {
                    const dirDeg = Math.atan2(lateralDiff, longitudinalDiff) * 180 / Math.PI;
                    label = `${slopeArrow(dirDeg)} ${angle.toFixed(1)}°`;
                }
                results[q.key] = { angle, label };
                q.shot.lie_angle = { angle, label };
            }
        });
    } catch (e) {
        console.error('[fetchLieAngles] API call failed:', e.message, e);
    }

    return results;
}

// 8-direction arrow for slope: 0°=uphill-forward, 90°=uphill-right, 180°=downhill, 270°=uphill-left
function slopeArrow(deg) {
    const norm = ((deg % 360) + 360) % 360;
    return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(norm / 45) % 8];
}

// Offset a GPS point by distance (meters) along a bearing (degrees)
function offsetPoint(point, bearingDeg, distM) {
    const R = 6371000;
    const lat1 = point.lat * Math.PI / 180;
    const lon1 = point.lon * Math.PI / 180;
    const brng = bearingDeg * Math.PI / 180;
    const d = distM / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

function buildShotMap(round) {
    const sc = round.scorecard;
    const holes = sc?.hole_scores ?? [];

    // Hole selector buttons
    const holeButtons = holes.map(hs => `
        <button class="hole-btn px-3 py-1 text-xs rounded-full border border-gray-300
            hover:bg-blue-50 hover:border-blue-400 transition" data-hole="${hs.hole_number}">
            H${hs.hole_number}
        </button>`).join('');

    return `
    <div class="flex flex-col gap-4" style="height: calc(100vh - 200px)">
        <!-- Header with hole buttons -->
        <div class="bg-white rounded-xl shadow-sm border p-4">
            <div class="flex items-center justify-between">
                <h3 class="text-lg font-semibold text-gray-700">${t('shotmap.title')}</h3>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">${t('shotmap.hole')}</span>
                    <button class="hole-btn px-3 py-1 text-xs rounded-full bg-blue-600 text-white border border-blue-600"
                        data-hole="all">${t('shotmap.all')}</button>
                    ${holeButtons}
                </div>
            </div>
            <div class="flex items-center gap-3 mt-3 min-h-[28px]">
                <div id="shot-hole-summary" class="hidden text-sm font-medium text-gray-700"></div>
                <button id="shot-edit-btn" class="hidden ml-auto px-3 py-1 text-xs rounded-full border border-gray-300"></button>
            </div>
        </div>

        <!-- Map and Timeline split layout -->
        <div class="flex gap-4 flex-1 min-h-0">
            <!-- Left: Map -->
            <div class="bg-white rounded-xl shadow-sm border p-4 flex flex-col flex-1">
                <div id="shot-map-wrapper" class="flex-1 mb-3">
                    <div id="shot-map"></div>
                </div>
                <div id="shot-edit-bar" class="hidden mb-3 p-3 rounded-lg bg-gray-50 border text-xs text-gray-600"></div>
                <div class="flex items-center justify-between pt-3 border-t">
                    <div id="shot-legend" class="flex flex-wrap gap-3 text-xs text-gray-500"></div>
                    <button id="trail-toggle" class="px-3 py-1 text-xs rounded-full border border-gray-300
                        hover:bg-gray-50 transition flex items-center gap-1">
                        <span id="trail-icon">👣</span> ${t('shotmap.trail')}
                    </button>
                </div>
            </div>

            <!-- Right: Timeline -->
            <div class="bg-white rounded-xl shadow-sm border p-4 flex flex-col flex-1">
                <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('shotmap.timeline.title')}</h3>
                <p class="text-xs text-gray-400 mb-4">${t('shotmap.timeline.desc')}</p>
                <div class="relative flex-1 min-h-0">
                    <canvas id="timeline-chart"></canvas>
                </div>
            </div>
        </div>
    </div>`;
}

// ── Shot Map: hole score + edit mode ─────────────────────────────────────────

// UI state for the Shot Map tab. `edit` is non-null only while one hole is being edited.
const shotMapUi = {
    hole: 'all',        // selected hole filter: 'all' or a hole number as a string
    edit: null,         // { holeNumber, original, draft, green, selectedId, pendingId, dirty, markers, onMapClick }
    restoreHole: null,  // hole to re-select after a save re-renders the tab
    layerIds: null,     // { holeLayers, holeLabelLayers } from the current renderShotMap()
};
let shotMapIdSeq = 0;
let suppressMapClickUntil = 0;   // ignore the synthetic click that follows a marker drag

// Club abbreviation for a shot (e.g. "7i", "3W", "Dr", "P")
function clubAbbr(shot) {
    const name = shot.club_name ?? '';
    const cat  = shot.club_category ?? '';
    if (cat === 'putt') return 'P';
    if (!name) return cat.slice(0,1).toUpperCase();
    const m = name.match(/^(\d+)[-\s]?(Wood|Iron|Hybrid)/i);
    if (m) {
        const t = m[2].toLowerCase();
        if (t === 'iron') return m[1] + 'i';
        if (t === 'hybrid') return m[1] + 'H';
        return m[1] + 'W';
    }
    if (name.length <= 3) return name;
    if (name === 'Driver') return 'Dr';
    if (name === 'Hybrid') return 'H';
    return name.slice(0, 2);
}

// Clubs offered in the picker (CLUB_ORDER is declared later in the file, so read it lazily)
function editClubList() {
    return CLUB_ORDER.filter(c => c !== 'unknown');
}

// Map a club name to the shot category used by CLUB_COLORS and the scorecard
function clubCategoryFor(name) {
    if (name === 'Driver') return 'tee';
    if (name === 'Putter') return 'putt';
    if (/Wood$/.test(name) || name === 'Hybrid') return 'fairway_wood';
    if (/Iron$/.test(name)) return 'iron';
    if (/^(PW|GW|SW|LW)$/.test(name)) return 'wedge';
    return 'unknown';
}

// Club id from the round's club list (0 when the club is not in it)
function clubIdFor(name) {
    const c = state.activeRound?.clubs?.find(c => c.name === name);
    return c ? c.club_id : 0;
}

// Strokes for a hole = non-putt shots + putts (matches the iOS editor)
function recalcScore(hs) {
    return hs.shots.filter(s => s.club_category !== 'putt').length + hs.putts;
}

// Single source of truth for from/to chaining. Each shot ends where the next begins;
// the last shot ends on the green, which is fixed when editing starts.
function rechain(e) {
    const shots = e.draft.shots;
    shots.forEach((s, i) => {
        s.to = i < shots.length - 1 ? { ...shots[i + 1].from } : { ...e.green };
        s.distance_meters = distMeters(s.from, s.to);
        delete s.lie_angle;
        delete s.elevation_gain;
    });
    e.draft.score = recalcScore(e.draft);
}

// Insert a new shot ordered by distance to the green (descending), as the iOS editor does
function insertShotByDistance(e, pt) {
    const d = distMeters(pt, e.green);
    let idx = e.draft.shots.findIndex(s => distMeters(s.from, e.green) < d);
    if (idx < 0) idx = e.draft.shots.length;
    const id = ++shotMapIdSeq;
    e.draft.shots.splice(idx, 0, {
        _id: id,
        from: { ...pt },
        to: { ...pt },
        club_id: 0,
        club_name: null,
        club_category: 'unknown',
        distance_meters: null,
        heart_rate: null,
        altitude_meters: null,
        swing_tempo: null,
        timestamp: null,
    });
    return id;
}

// Strip client-only fields and send only the model fields to Rust
function hsToClean(hs) {
    return {
        hole_number: hs.hole_number,
        score: hs.score,
        putts: hs.putts,
        fairway_hit: !!hs.fairway_hit,
        shots: hs.shots.map(s => ({
            from: { lat: s.from.lat, lon: s.from.lon },
            to:   { lat: s.to.lat,   lon: s.to.lon },
            club_id: s.club_id ?? 0,
            club_name: s.club_name ?? null,
            club_category: s.club_category ?? null,
            distance_meters: s.distance_meters ?? null,
            heart_rate: s.heart_rate ?? null,
            altitude_meters: s.altitude_meters ?? null,
            swing_tempo: s.swing_tempo ?? null,
            timestamp: s.timestamp ?? null,
        })),
    };
}

function shotsLabel(n) {
    return t(n === 1 ? 'shotmap.shotsOne' : 'shotmap.shotsMany', { n });
}

// Header summary for the selected hole: "Hole 7 · Par 4 · 5 shots" (live while editing)
function updateHoleSummary() {
    const el = document.getElementById('shot-hole-summary');
    if (!el) return;
    const hole = shotMapUi.hole;
    const round = state.activeRound;
    const hs = hole === 'all' ? null
        : (shotMapUi.edit?.draft ?? round?.scorecard?.hole_scores?.find(h => String(h.hole_number) === hole));
    if (!hs) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    const par = round?.scorecard?.hole_definitions?.find(h => String(h.hole_number) === hole)?.par;
    const shots = hs.score > 0 ? hs.score : hs.shots.length + hs.putts;
    el.textContent = par
        ? t('shotmap.holeSummary', { hole, par, shots: shotsLabel(shots) })
        : t('shotmap.holeSummaryNoPar', { hole, shots: shotsLabel(shots) });
    el.classList.remove('hidden');
}

function updateEditButton() {
    const btn = document.getElementById('shot-edit-btn');
    if (!btn) return;
    const hole = shotMapUi.hole;
    const editing = !!shotMapUi.edit;
    const hs = hole === 'all' ? null
        : state.activeRound?.scorecard?.hole_scores?.find(h => String(h.hole_number) === hole);
    const hasShots = !!hs?.shots?.length;
    btn.classList.toggle('hidden', hole === 'all');
    btn.disabled = !editing && !hasShots;
    btn.title = hasShots || editing ? '' : t('shotmap.edit.noShots');
    btn.textContent = editing ? t('shotmap.done') : t('shotmap.edit');
    btn.className = `ml-auto px-3 py-1 text-xs rounded-full border transition disabled:opacity-40 disabled:cursor-not-allowed ${
        editing ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'}`;
    if (hole === 'all') btn.classList.add('hidden');
}

// Called by the hole buttons after they change the visible layers
function onShotMapHoleSelected(hole) {
    shotMapUi.hole = hole;
    updateHoleSummary();
    updateEditButton();
}

// Show the per-hole layers for `hole` ('all' shows the combined layers), as the hole buttons do
function applyHoleVisibility(hole) {
    const L = shotMapUi.layerIds;
    console.log('[shotmap] applyHoleVisibility', hole, 'hasLayers', !!L);
    if (!activeMap || !L) return;
    const all = hole === 'all';
    const setVis = (id, vis) => { if (activeMap.getLayer(id)) activeMap.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none'); };
    [L.holeLayers, L.holeLabelLayers].forEach(group =>
        Object.entries(group).forEach(([n, ids]) => ids.forEach(id => setVis(id, !all && n === hole))));
    setVis('all-shots', all);
    setVis('putt-labels', !all);
}

function hideAllShotLayers() {
    const L = shotMapUi.layerIds;
    if (!activeMap || !L) return;
    [L.holeLayers, L.holeLabelLayers].forEach(group =>
        Object.values(group).forEach(ids => ids.forEach(id => {
            if (activeMap.getLayer(id)) activeMap.setLayoutProperty(id, 'visibility', 'none');
        })));
    ['all-shots', 'putt-labels'].forEach(id => {
        if (activeMap.getLayer(id)) activeMap.setLayoutProperty(id, 'visibility', 'none');
    });
}

// Simple modal; returns { el, close }. A click on the backdrop reports the element itself as target.
function openModal(innerHtml) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:200;';
    wrap.innerHTML = `<div class="bg-white rounded-xl shadow-xl p-5 w-96 max-w-[90vw] max-h-[80vh] overflow-auto">${innerHtml}</div>`;
    document.body.appendChild(wrap);
    return { el: wrap, close: () => wrap.remove() };
}

// Yes/No-style prompt. Resolves to the chosen key, or null when dismissed.
function askChoice(message, options) {
    return new Promise(resolve => {
        const btns = options.map(o => `<button data-key="${o.key}" class="px-3 py-1.5 text-xs rounded-lg ${
            o.primary ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}">${o.label}</button>`).join('');
        const m = openModal(`<p class="text-sm text-gray-700 mb-4">${message}</p><div class="flex justify-end gap-2">${btns}</div>`);
        m.el.addEventListener('click', ev => {
            if (ev.target === m.el) { m.close(); resolve(null); return; }
            const b = ev.target.closest('button[data-key]');
            if (!b) return;
            m.close();
            resolve(b.dataset.key);
        });
    });
}

// Club picker. Resolves to the club name, or null when cancelled.
function pickClub(current, title) {
    return new Promise(resolve => {
        const btns = editClubList().map(c => `<button data-club="${c}" class="px-2 py-2 text-xs rounded border ${
            c === current ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}">${c}</button>`).join('');
        const m = openModal(`
            <h4 class="font-semibold text-gray-700 mb-3">${title}</h4>
            <div class="grid grid-cols-3 gap-2">${btns}</div>
            <div class="flex justify-end mt-4">
                <button data-cancel="1" class="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">${t('shotmap.edit.cancel')}</button>
            </div>`);
        m.el.addEventListener('click', ev => {
            if (ev.target === m.el) { m.close(); resolve(null); return; }
            const b = ev.target.closest('button');
            if (!b) return;
            m.close();
            resolve(b.dataset.club ?? null);
        });
    });
}

// Reorder sheet with up/down buttons. Applies the new order to the draft on Apply.
function openReorderSheet() {
    const e = shotMapUi.edit;
    if (!e) return;
    const order = [...e.draft.shots];
    const m = openModal(`
        <h4 class="font-semibold text-gray-700 mb-3">${t('shotmap.edit.reorderTitle')}</h4>
        <div data-list></div>
        <div class="flex justify-end gap-2 mt-4">
            <button data-cancel="1" class="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">${t('shotmap.edit.cancel')}</button>
            <button data-apply="1" class="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">${t('shotmap.edit.apply')}</button>
        </div>`);
    const list = m.el.querySelector('[data-list]');
    const renderList = () => {
        list.innerHTML = order.map((s, i) => `
            <div class="flex items-center gap-2 py-1.5 border-b text-sm">
                <span class="w-6 text-gray-400">${i + 1}</span>
                <span class="flex-1">${clubAbbr(s)} · ${s.club_name ?? '—'}</span>
                <button data-up="${i}" ${i === 0 ? 'disabled' : ''} class="px-2 py-0.5 border rounded disabled:opacity-30">▲</button>
                <button data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} class="px-2 py-0.5 border rounded disabled:opacity-30">▼</button>
            </div>`).join('');
    };
    renderList();
    m.el.addEventListener('click', ev => {
        const up = ev.target.closest('[data-up]');
        const down = ev.target.closest('[data-down]');
        if (up || down) {
            const i = Number((up ?? down).dataset[up ? 'up' : 'down']);
            const j = up ? i - 1 : i + 1;
            [order[i], order[j]] = [order[j], order[i]];
            renderList();
            return;
        }
        if (ev.target === m.el || ev.target.closest('[data-cancel]')) { m.close(); return; }
        if (ev.target.closest('[data-apply]')) {
            m.close();
            if (shotMapUi.edit !== e) return;
            e.draft.shots = order;
            e.dirty = true;
            rechain(e);
            buildEditMarkers();
            refreshEditLayer();
            renderEditBar();
            updateHoleSummary();
        }
    });
}

// Marker-driven selection, drawing and club changes for the hole being edited
function refreshEditLayer() {
    const e = shotMapUi.edit;
    if (!e || !activeMap) return;
    const lines = [], labels = [];
    e.draft.shots.forEach(s => {
        const color = CLUB_COLORS[s.club_category] ?? CLUB_COLORS.unknown;
        lines.push({
            type: 'Feature',
            properties: { color },
            geometry: { type: 'LineString', coordinates: [[s.from.lon, s.from.lat], [s.to.lon, s.to.lat]] },
        });
        if (s.distance_meters != null) {
            labels.push({
                type: 'Feature',
                properties: { label: `${Math.round(metersToYards(s.distance_meters))}y` },
                geometry: { type: 'Point', coordinates: [(s.from.lon + s.to.lon) / 2, (s.from.lat + s.to.lat) / 2] },
            });
        }
    });
    activeMap.getSource('edit-lines')?.setData({ type: 'FeatureCollection', features: lines });
    activeMap.getSource('edit-dist')?.setData({ type: 'FeatureCollection', features: labels });
}

function updateMarkerStyles() {
    const e = shotMapUi.edit;
    if (!e) return;
    e.draft.shots.forEach(s => {
        const m = e.markers.get(s._id);
        if (!m) return;
        const sel = s._id === e.selectedId;
        m.el.textContent = clubAbbr(s);
        m.el.style.background = CLUB_COLORS[s.club_category] ?? CLUB_COLORS.unknown;
        m.el.style.transform = sel ? 'scale(1.3)' : 'scale(1)';
        m.el.style.boxShadow = sel ? '0 0 0 3px #facc15, 0 1px 3px rgba(0,0,0,.4)' : '0 1px 3px rgba(0,0,0,.4)';
        m.el.style.zIndex = sel ? '2' : '1';
    });
}

function buildEditMarkers() {
    const e = shotMapUi.edit;
    if (!e || !activeMap) return;
    e.markers.forEach(({ marker }) => marker.remove());
    e.markers.clear();
    e.draft.shots.forEach(s => {
        // MapLibre positions the element passed to Marker by setting its transform, so the
        // root must not be restyled with transform. The visible dot is an inner child.
        const root = document.createElement('div');
        root.className = 'shot-edit-marker';
        root.style.cssText = 'width:26px;height:26px;cursor:grab;';
        const el = document.createElement('div');
        el.style.cssText = 'width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:2px solid #fff;'
            + 'color:#fff;font:700 10px/22px sans-serif;text-align:center;user-select:none;'
            + 'box-shadow:0 1px 3px rgba(0,0,0,.4);';
        root.appendChild(el);
        root.addEventListener('click', ev => {
            ev.stopPropagation();
            if (Date.now() < suppressMapClickUntil) return;
            if (shotMapUi.edit?.selectedId === s._id) {
                openEditClubPicker(s._id);
            } else {
                selectShot(s._id);
            }
        });
        const marker = new maplibregl.Marker({ element: root, draggable: true })
            .setLngLat([s.from.lon, s.from.lat])
            .addTo(activeMap);
        marker.on('dragstart', () => { activeMap.dragPan.disable(); });
        marker.on('drag', () => {
            const ll = marker.getLngLat();
            s.from = { lat: ll.lat, lon: ll.lng };
            e.dirty = true;
            rechain(e);
            refreshEditLayer();
        });
        marker.on('dragend', () => {
            activeMap.dragPan.enable();
            suppressMapClickUntil = Date.now() + 250;
            selectShot(s._id);
        });
        e.markers.set(s._id, { marker, el });
    });
    updateMarkerStyles();
}

function selectShot(id) {
    const e = shotMapUi.edit;
    if (!e) return;
    e.selectedId = id;
    updateMarkerStyles();
    renderEditBar();
}

// Tapping an empty spot on the map stages a new shot and opens the club picker
function onEditMapClick(ev) {
    const e = shotMapUi.edit;
    if (!e || e.pendingId) return;
    if (Date.now() < suppressMapClickUntil) return;
    if (ev.originalEvent?.target?.closest?.('.shot-edit-marker')) return;
    const id = insertShotByDistance(e, { lat: ev.lngLat.lat, lon: ev.lngLat.lng });
    e.pendingId = id;
    e.selectedId = id;
    rechain(e);
    buildEditMarkers();
    refreshEditLayer();
    renderEditBar();
    updateHoleSummary();
    openEditClubPicker(id);
}

function cancelPendingShot(e) {
    e.draft.shots = e.draft.shots.filter(s => s._id !== e.pendingId);
    e.pendingId = null;
    e.selectedId = null;
    rechain(e);
    buildEditMarkers();
    refreshEditLayer();
    renderEditBar();
    updateHoleSummary();
}

function applyClub(e, id, name) {
    const s = e.draft.shots.find(x => x._id === id);
    if (!s) return;
    s.club_name = name;
    s.club_category = clubCategoryFor(name);
    s.club_id = clubIdFor(name);
    if (e.pendingId === id) e.pendingId = null;
    e.dirty = true;
    rechain(e);
    refreshEditLayer();
    updateMarkerStyles();
    renderEditBar();
    updateHoleSummary();
}

async function openEditClubPicker(shotId) {
    const e = shotMapUi.edit;
    if (!e || !shotId) return;
    const s = e.draft.shots.find(x => x._id === shotId);
    if (!s) return;
    const pending = e.pendingId === shotId;
    const picked = await pickClub(s.club_name,
        t(pending ? 'shotmap.edit.selectClub' : 'shotmap.edit.changeClub'));
    if (shotMapUi.edit !== e) return;
    if (picked) applyClub(e, shotId, picked);
    else if (pending) cancelPendingShot(e);
}

async function deleteSelectedShot() {
    const e = shotMapUi.edit;
    if (!e || !e.selectedId) return;
    const ok = await askChoice(t('shotmap.edit.deleteConfirm'), [
        { key: 'no', label: t('shotmap.edit.no') },
        { key: 'yes', label: t('shotmap.edit.yes'), primary: true },
    ]);
    if (ok !== 'yes' || shotMapUi.edit !== e) return;
    e.draft.shots = e.draft.shots.filter(s => s._id !== e.selectedId);
    e.selectedId = null;
    e.dirty = true;
    rechain(e);
    buildEditMarkers();
    refreshEditLayer();
    renderEditBar();
    updateHoleSummary();
}

function adjustPutts(delta) {
    const e = shotMapUi.edit;
    if (!e) return;
    e.draft.putts = Math.max(0, e.draft.putts + delta);
    e.dirty = true;
    rechain(e);
    renderEditBar();
    updateHoleSummary();
}

function renderEditBar() {
    const bar = document.getElementById('shot-edit-bar');
    if (!bar) return;
    const e = shotMapUi.edit;
    if (!e) {
        bar.classList.add('hidden');
        bar.innerHTML = '';
        return;
    }
    const hasSel = e.draft.shots.some(s => s._id === e.selectedId);
    const hint = hasSel
        ? t('shotmap.edit.dragToMove')
        : `${t('shotmap.edit.hintAdd')} · ${t('shotmap.edit.hintSelect')}`;
    bar.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
            <span>${hint}</span>
            <div class="flex items-center gap-2 flex-wrap">
                ${hasSel ? `
                <button data-act="club" class="px-2.5 py-1 rounded border border-gray-300 hover:bg-gray-50">${t('shotmap.edit.changeClub')}</button>
                <button data-act="delete" class="px-2.5 py-1 rounded bg-red-600 text-white">${t('shotmap.edit.deleteShot')}</button>` : ''}
                ${e.draft.shots.length > 1 ? `<button data-act="reorder" class="px-2.5 py-1 rounded border border-gray-300 hover:bg-gray-50">${t('shotmap.edit.reorder')}</button>` : ''}
                <span class="flex items-center gap-1 ml-1">
                    <span>${t('shotmap.edit.putts')}</span>
                    <button data-act="putt-" class="px-2 rounded border border-gray-300 hover:bg-gray-50">−</button>
                    <span class="w-5 text-center font-medium">${e.draft.putts}</span>
                    <button data-act="putt+" class="px-2 rounded border border-gray-300 hover:bg-gray-50">+</button>
                </span>
            </div>
        </div>`;
    bar.classList.remove('hidden');
}

function onEditBarClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
        case 'club':   openEditClubPicker(shotMapUi.edit?.selectedId); break;
        case 'delete': deleteSelectedShot(); break;
        case 'reorder': openReorderSheet(); break;
        case 'putt-':  adjustPutts(-1); break;
        case 'putt+':  adjustPutts(1); break;
    }
}

function enterEditMode() {
    const round = state.activeRound;
    const hole = shotMapUi.hole;
    if (!round || !activeMap || shotMapUi.edit || hole === 'all') return;
    const src = round.scorecard?.hole_scores?.find(h => String(h.hole_number) === hole);
    if (!src?.shots?.length) return;

    const original = structuredClone(src);
    const draft = structuredClone(src);
    draft.shots.forEach(s => { s._id = ++shotMapIdSeq; });
    const green = { ...src.shots[src.shots.length - 1].to };
    const e = {
        holeNumber: src.hole_number, original, draft, green,
        selectedId: null, pendingId: null, dirty: false,
        markers: new Map(), onMapClick: null,
    };
    shotMapUi.edit = e;

    hideAllShotLayers();
    activeMap.addSource('edit-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    activeMap.addSource('edit-dist', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    activeMap.addLayer({
        id: 'edit-line-layer', type: 'line', source: 'edit-lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
    });
    activeMap.addLayer({
        id: 'edit-dist-layer', type: 'symbol', source: 'edit-dist',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.5], 'text-allow-overlap': true },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    e.onMapClick = onEditMapClick;
    activeMap.on('click', e.onMapClick);

    buildEditMarkers();
    refreshEditLayer();
    // MapLibre's grab/pan cursor classes would win over a plain style, so force it inline
    activeMap.getCanvasContainer().style.setProperty('cursor', 'crosshair', 'important');
    activeMap.getCanvas().style.setProperty('cursor', 'crosshair', 'important');
    document.querySelectorAll('.hole-btn').forEach(b => { b.disabled = true; b.classList.add('opacity-40'); });
    const bar = document.getElementById('shot-edit-bar');
    if (bar) bar.onclick = onEditBarClick;
    renderEditBar();
    updateHoleSummary();
    updateEditButton();
}

// Leave edit mode without saving. The draft is dropped and the hole's normal layers return.
function exitEdit() {
    const e = shotMapUi.edit;
    console.log('[shotmap] exitEdit', { hole: e?.holeNumber, dirty: e?.dirty });
    if (!e) return;
    e.markers.forEach(({ marker }) => marker.remove());
    e.markers.clear();
    if (activeMap) {
        if (e.onMapClick) activeMap.off('click', e.onMapClick);
        activeMap.dragPan?.enable();
        ['edit-line-layer', 'edit-dist-layer'].forEach(id => { if (activeMap.getLayer(id)) activeMap.removeLayer(id); });
        ['edit-lines', 'edit-dist'].forEach(id => { if (activeMap.getSource(id)) activeMap.removeSource(id); });
        activeMap.getCanvasContainer().style.removeProperty('cursor');
        activeMap.getCanvas().style.removeProperty('cursor');
    }
    shotMapUi.edit = null;
    const bar = document.getElementById('shot-edit-bar');
    if (bar) { bar.classList.add('hidden'); bar.innerHTML = ''; bar.onclick = null; }
    document.querySelectorAll('.hole-btn').forEach(b => { b.disabled = false; b.classList.remove('opacity-40'); });
    applyHoleVisibility(shotMapUi.hole);
    updateEditButton();
    updateHoleSummary();
}

// Persist the draft hole through Rust, then reload the round, scorecard and round list.
// Returns true on success. Keeps the draft on failure.
async function saveEdits({ rerender = true } = {}) {
    const e = shotMapUi.edit;
    const round = state.activeRound;
    if (!e || !round) return false;
    try {
        const payload = hsToClean(e.draft);
        console.log('[shotmap] saving hole', payload.hole_number, 'shots', payload.shots.length, payload.shots.map(x => x.club_name));
        const updated = await updateRoundHoles(round.id, [payload]);
        console.log('[shotmap] saved; returned shots for hole', e.holeNumber, updated.scorecard?.hole_scores?.find(h => h.hole_number === e.holeNumber)?.shots.map(x => x.club_name));
        updated._patterns = round._patterns;
        updated._feedback = round._feedback;
        state.activeRound = updated;
        delete elevationGainCache[round.id];
        exitEdit();
        getAllRounds()
            .then(rounds => { state.rounds = rounds; renderRoundsList(); updateStats(); })
            .catch(err => console.error('[saveEdits] round list refresh failed:', err));
        shotMapUi.restoreHole = rerender ? String(e.holeNumber) : null;
        if (rerender) renderDetailTabs();
        return true;
    } catch (err) {
        toast(t('shotmap.edit.saveFailed', { error: err }), true);
        return false;
    }
}

// Done button: ask to save or discard if there are changes
async function finishEdit() {
    const e = shotMapUi.edit;
    if (!e) return;
    if (!e.dirty) { exitEdit(); return; }
    const choice = await askChoice(t('shotmap.edit.saveConfirm'), [
        { key: 'cancel', label: t('shotmap.edit.cancel') },
        { key: 'no', label: t('shotmap.edit.no') },
        { key: 'yes', label: t('shotmap.edit.yes'), primary: true },
    ]);
    if (choice === 'yes') await saveEdits();
    else if (choice === 'no') exitEdit();
}

// Before leaving the Shot Map (tab, round or view change), settle any open edit.
// Resolves to true when the caller may continue.
async function confirmLeaveShotMapEdit({ rerender = false } = {}) {
    const e = shotMapUi.edit;
    if (!e) return true;
    if (!e.dirty) { exitEdit(); return true; }
    const choice = await askChoice(t('shotmap.edit.saveConfirm'), [
        { key: 'cancel', label: t('shotmap.edit.cancel') },
        { key: 'no', label: t('shotmap.edit.no') },
        { key: 'yes', label: t('shotmap.edit.yes'), primary: true },
    ]);
    if (choice === 'yes') return saveEdits({ rerender });
    if (choice === 'no') { exitEdit(); return true; }
    return false;
}

// Mini HR sparkline for shot popups — shows ±5 min of HR around the shot timestamp
function hrSparkline(shot, healthTimeline) {
    if (!shot.timestamp || !healthTimeline?.length) return '';
    const W = 120, H = 32, PAD = 2;
    const windowSec = 300; // ±5 min
    const pts = healthTimeline.filter(s =>
        s.heart_rate != null &&
        Math.abs(s.timestamp - shot.timestamp) <= windowSec
    );
    if (pts.length < 3) return '';
    const hrs = pts.map(s => s.heart_rate);
    const minHr = Math.min(...hrs), maxHr = Math.max(...hrs);
    const range = maxHr - minHr || 1;
    const xStep = (W - PAD * 2) / (pts.length - 1);
    const toY = v => PAD + (H - PAD * 2) * (1 - (v - minHr) / range);
    const line = pts.map((s, i) => `${PAD + i * xStep},${toY(s.heart_rate)}`).join(' ');
    // Shot position marker
    let markerX = null;
    let closestDiff = Infinity;
    pts.forEach((s, i) => {
        const d = Math.abs(s.timestamp - shot.timestamp);
        if (d < closestDiff) { closestDiff = d; markerX = PAD + i * xStep; }
    });
    const marker = markerX != null
        ? `<line x1="${markerX}" y1="0" x2="${markerX}" y2="${H}" stroke="#facc15" stroke-width="1.5"/>`
        : '';
    return `<svg width="${W}" height="${H}" style="display:block;margin:4px 0 0">
        <polyline points="${line}" fill="none" stroke="#ef4444" stroke-width="1.5"/>
        ${marker}
        <text x="1" y="9" font-size="8" fill="#999">${maxHr}</text>
        <text x="1" y="${H - 1}" font-size="8" fill="#999">${minHr}</text>
    </svg>`;
}

// Direction arrow SVG — traffic-signal style (left / straight / right)
function dirArrowSvg(dev) {
    const abs = Math.abs(dev);
    let arrow, label, bg;
    if (abs < 15) {
        arrow = `<polygon points="20,6 28,22 12,22" fill="white"/>`; // up arrow
        label = 'Straight';
        bg = '#22c55e'; // green
    } else {
        const isFar = abs > 30;
        bg = isFar ? '#ef4444' : '#eab308'; // red or yellow
        label = (dev > 0 ? (isFar ? 'Far R' : 'Right') : (isFar ? 'Far L' : 'Left'));
        if (dev > 0) {
            arrow = `<polygon points="28,14 14,6 14,22" fill="white"/>`; // right arrow
        } else {
            arrow = `<polygon points="12,14 26,6 26,22" fill="white"/>`; // left arrow
        }
    }
    return `<div style="text-align:center">
        <svg width="40" height="28" style="display:block;margin:0 auto">
            <rect width="40" height="28" rx="6" fill="${bg}"/>
            ${arrow}
        </svg>
        <div style="font-size:9px;color:#666;margin-top:2px">${label}</div>
    </div>`;
}

const CLUB_ORDER = [
    'Driver', '3-Wood', '5-Wood', '7-Wood', 'Hybrid',
    '2-Iron', '3-Iron', '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron',
    'PW', 'GW', 'SW', 'LW', 'Putter', 'unknown',
];
function clubSortKey(name) {
    const idx = CLUB_ORDER.indexOf(name);
    return idx >= 0 ? idx : CLUB_ORDER.length;
}

const CLUB_COLORS = {
    tee:          '#ef4444',  // red
    fairway_wood: '#f97316',  // orange
    iron:         '#3b82f6',  // blue
    wedge:        '#8b5cf6',  // purple
    putt:         '#10b981',  // green
    unknown:      '#9ca3af',  // gray
};

async function fetchAndUpdateLieAnglesForStats(round) {
    const lies = await fetchLieAngles(round);
    Object.entries(lies).forEach(([key, lie]) => {
        updateLieAngleCell(key, lie.label);
    });
    // Clear spinners for shots that got no elevation data
    const sc = round.scorecard;
    sc?.hole_scores?.forEach(hs => {
        hs.shots.forEach((shot, idx) => {
            if (shot.club_category === 'putt') return;
            const key = `${hs.hole_number}-${idx}`;
            if (!(key in lies)) clearLieAngleSpinner(key);
        });
    });
}

function updateLieAngleCell(key, label) {
    const cellId = `lie-${key}`;
    const cell = document.getElementById(cellId);
    if (cell) {
        cell.innerHTML = label;
        console.log(`[updateLieAngleCell] Updated ${cellId} = ${label}`);
    } else {
        console.warn(`[updateLieAngleCell] Cell #${cellId} not found in DOM`);
    }
}

function clearLieAngleSpinner(key) {
    const cellId = `lie-${key}`;
    const cell = document.getElementById(cellId);
    if (cell) {
        cell.innerHTML = '';
        console.log(`[clearLieAngleSpinner] Cleared spinner for ${cellId}`);
    } else {
        console.warn(`[clearLieAngleSpinner] Cell #${cellId} not found in DOM`);
    }
}


const elevationGainCache = {}; // roundId → { "hole-shotIdx": gain }

async function fetchAndUpdateElevationGainForStats(round) {
    const rid = round.id;
    if (rid in elevationGainCache) {
        updateElevationGainCells(elevationGainCache[rid]);
        return;
    }

    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) {
        elevationGainCache[rid] = {};
        return;
    }

    // Collect green centers (last shot destination per hole)
    const queries = [];
    sc.hole_scores.forEach(hs => {
        const shots = hs.shots;
        if (!shots.length) return;
        const greenPoint = shots[shots.length - 1].to;
        queries.push({
            key: `green-${hs.hole_number}`,
            point: greenPoint,
            hole: hs.hole_number
        });
    });

    if (!queries.length) {
        elevationGainCache[rid] = {};
        return;
    }

    const locations = queries.map(q => `${q.point.lat.toFixed(6)},${q.point.lon.toFixed(6)}`);
    const results = {};

    try {
        console.log(`[fetch_green_elevations] Fetching ${locations.length} green centers`);
        const greenElevs = await invoke('fetch_elevations', { locations });

        if (!greenElevs || greenElevs.length === 0) {
            console.error('[fetch_green_elevations] Empty response from backend');
            elevationGainCache[rid] = {};
            return;
        }

        // Map green elevations and calculate gains for approach shots
        const greenElevMap = {};
        queries.forEach((q, idx) => {
            greenElevMap[q.hole] = greenElevs[idx];
        });

        // Calculate elevation gain: approach shot (landing on green) to green, others to next shot
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            const greenElev = greenElevMap[hs.hole_number];

            shots.forEach((shot, idx) => {
                if (shot.club_category === 'putt' || shot.altitude_meters == null) return;

                const shotAlt = shot.altitude_meters;
                let targetAlt = null;

                // Last shot (approach to green) uses green elevation
                if (idx === shots.length - 1) {
                    targetAlt = greenElev;
                } else {
                    // Other shots use next shot's altitude
                    targetAlt = shots[idx + 1]?.altitude_meters ?? null;
                }

                if (targetAlt != null) {
                    const gain = Math.round(targetAlt - shotAlt);
                    const key = `${hs.hole_number}-${idx}`;
                    results[key] = gain;
                    shot.elevation_gain = gain;
                    updateElevationGainCell(key, gain);
                }
            });
        });

        console.log(`[fetch_green_elevations] Calculated elevation gains for ${Object.keys(results).length} shots`);

    } catch (e) {
        console.error('[fetch_green_elevations] API call failed:', e.message, e);
    }

    elevationGainCache[rid] = results;
}

function updateElevationGainCell(key, gain) {
    const cellId = `elev-${key}`;
    const cell = document.getElementById(cellId);
    if (cell) {
        const label = gain === 0 ? 'Flat' : `${gain > 0 ? '↑' : '↓'}${mToFt(Math.abs(gain))}ft`;
        cell.innerHTML = label;
        console.log(`[updateElevationGainCell] Updated ${cellId} = ${label}`);
    } else {
        console.warn(`[updateElevationGainCell] Cell #${cellId} not found in DOM`);
    }
}

function updateElevationGainCells(cachedGains) {
    Object.entries(cachedGains).forEach(([key, gain]) => {
        if (gain != null) {
            updateElevationGainCell(key, gain);
        }
    });
}

async function renderCourseStatsAsync(round) {
    const statsEl = document.getElementById('course-stats');
    if (!statsEl) return;
    await Promise.all([
        fetchAndUpdateLieAnglesForStats(round),
        fetchAndUpdateElevationGainForStats(round)
    ]);
}

async function renderShotMap(round) {
    const mapEl = document.getElementById('shot-map');
    if (!mapEl) return;

    console.log('[shotmap] render start', { hole: shotMapUi.hole, restoreHole: shotMapUi.restoreHole, editing: !!shotMapUi.edit, roundId: round?.id });
    if (shotMapUi.edit) exitEdit();
    shotMapUi.layerIds = null;
    shotMapUi.hole = 'all';
    // A save re-renders this tab; re-select the hole that was being edited
    const restoreHole = shotMapUi.restoreHole;
    shotMapUi.restoreHole = null;
    document.getElementById('shot-edit-btn')?.addEventListener('click', () => {
        if (shotMapUi.edit) finishEdit();
        else enterEditMode();
    });

    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) {
        mapEl.innerHTML = `<p class="text-gray-400 text-sm text-center py-8">${t('shotmap.nodata')}</p>`;
        return;
    }

    // Build timeline first so activeTimelinePts is available for shot features
    renderTimelineChart(round);

    // Fetch lie angles (lazy, cached)
    const lieAngles = await fetchLieAngles(round);

    // Fetch green elevations for elevation gain display
    const greenElevMap = {};
    try {
        const greenLocations = sc.hole_scores
            .map(hs => {
                const lastShot = hs.shots[hs.shots.length - 1];
                return lastShot?.to ? `${lastShot.to.lat.toFixed(6)},${lastShot.to.lon.toFixed(6)}` : null;
            })
            .filter(Boolean);
        if (greenLocations.length > 0) {
            console.log(`[renderShotMap] Fetching ${greenLocations.length} green elevations`);
            const greenElevs = await invoke('fetch_elevations', { locations: greenLocations });
            sc.hole_scores.forEach((hs, idx) => {
                if (greenElevs[idx] != null) {
                    greenElevMap[hs.hole_number] = greenElevs[idx];
                }
            });
        }
    } catch (e) {
        console.error('[renderShotMap] Failed to fetch green elevations:', e.message);
    }

    // Destroy previous map instance
    if (activeMap) { activeMap.remove(); activeMap = null; }

    // Collect all shot positions to compute map bounds
    const allShots = sc.hole_scores.flatMap(hs =>
        hs.shots.map(s => ({ ...s, hole_number: hs.hole_number, score: hs.score }))
    );
    if (!allShots.length) return;

    const lats = allShots.flatMap(s => [s.from.lat, s.to.lat]);
    const lons = allShots.flatMap(s => [s.from.lon, s.to.lon]);
    const bounds = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
    ];

    // Init Maplibre map with OSM tiles
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

    activeMap = new maplibregl.Map({
        container: 'shot-map',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                osm: {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors',
                    maxzoom: 19,
                }
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
        },
        center: [centerLon, centerLat],
        zoom: 13,
        scrollZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        attributionControl: false
    });

    activeMap.on('error', e => console.error('[shotmap] map error', e?.error?.message ?? e));
    // Resize map on container resize
    const resizeObserver = new ResizeObserver(() => activeMap?.resize?.());
    resizeObserver.observe(document.getElementById('shot-map-wrapper'));

    // Layer groups per hole — track layer IDs for visibility toggling
    const holeLayers = {};
    const holeLabelLayers = {};
    const allLayerIds = new Set();
    sc.hole_scores.forEach(hs => {
        holeLayers[hs.hole_number] = [];
        holeLabelLayers[hs.hole_number] = [];
    });
    shotMapUi.layerIds = { holeLayers, holeLabelLayers };

    // All source/layer creation and interactions happen after map loads
    activeMap.on('load', () => {
        // Add zoom controls
        activeMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        console.log('Map loaded, building shot visualizations. allShots count:', allShots.length);
        activeMap.fitBounds(bounds, { padding: 70, duration: 0 });
        console.log('fitBounds completed, now building features');

    // Draw shots — build Maplibre sources and layers
    const holePutts = {};
    sc.hole_scores.forEach(hs => { holePutts[hs.hole_number] = hs.putts; });


    console.log('Building SG lookup...');
    const sgLookup = buildSgLookup(round);
    console.log('SG lookup built');
    const holeShotIdx = {};

    console.log('Computing hole bearings...');
    const holeBearings = {};
    const holeGreenCenters = {};
    sc.hole_scores.forEach(hs => {
        if (!hs.shots.length) return;
        // Use green center (last shot destination) as the target for all shots on this hole
        holeGreenCenters[hs.hole_number] = hs.shots[hs.shots.length - 1].to;
    });
    console.log('Hole bearings computed. Starting feature loop...');

    // Build GeoJSON features for each hole
    const shotLines = {}; // polylines per hole
    const shotOrigins = {}; // origin circles per hole
    const shotDests = {}; // destination circles per hole
    const shotLabels = {}; // club + distance labels per hole

    // Build a map of GPS positions to closest timeline index for faster lookup
    const posToTimelineIdx = {};
    if (round.shots?.length > 0) {
        // Garmin: map activity shot positions to closest health timeline point
        round.shots.forEach(actShot => {
            if (!actShot.position || !actShot.timestamp) return;
            let closestIdx = 0, closestDiff = Infinity;
            activeTimelinePts.forEach((s, i) => {
                const diff = Math.abs((s.timestamp + GARMIN_EPOCH) - (actShot.timestamp + GARMIN_EPOCH));
                if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
            });
            const key = `${actShot.position.lat.toFixed(6)},${actShot.position.lon.toFixed(6)}`;
            posToTimelineIdx[key] = closestIdx;
        });
    }

    let featureIdx = -1;
    try {
        allShots.forEach((shot, idx) => {
            featureIdx = idx;
            if (idx === 0) console.log('Processing first shot...');
            const hole = String(shot.hole_number);
            const cat = shot.club_category ?? 'unknown';
            const color = CLUB_COLORS[cat] ?? CLUB_COLORS.unknown;
            const club = shot.club_name ?? (cat === 'putt' ? 'Putter' : cat);
            const isPutt = cat === 'putt';
            const shotNum = idx + 1;

            // Find closest timeline index for this shot
            let timelineIdx = null;
            if (round.shots?.length > 0) {
                // Try to find matching activity shot by position proximity
                let bestDist = Infinity, bestIdx = null;
                for (const actShot of round.shots) {
                    if (!actShot.position) continue;
                    const d = (actShot.position.lat - shot.from.lat) ** 2
                            + (actShot.position.lon - shot.from.lon) ** 2;
                    if (d < bestDist) { bestDist = d; bestIdx = actShot; }
                }
                if (bestIdx && bestDist < 0.0001) { // ~10m threshold
                    const key = `${bestIdx.position.lat.toFixed(6)},${bestIdx.position.lon.toFixed(6)}`;
                    timelineIdx = posToTimelineIdx[key];
                }
            } else {
                // iPhone: estimate timeline index based on shot order within hole
                // Find all shots for this hole and estimate position in timeline
                const holeShots = sc.hole_scores.find(hs => hs.hole_number === parseInt(hole))?.shots ?? [];
                const shotOrderInHole = holeShots.findIndex(s => s.from.lat === shot.from.lat && s.from.lon === shot.from.lon);
                if (shotOrderInHole >= 0 && activeHoleMarkers.length > 0) {
                    const holeMarker = activeHoleMarkers.find(m => m.label === `H${hole}`);
                    if (holeMarker) {
                        // Estimate: spread shots evenly within the hole's timeline window
                        const holeIdx = activeHoleMarkers.findIndex(m => m.label === `H${hole}`);
                        const nextHoleIdx = holeIdx + 1 < activeHoleMarkers.length
                            ? activeHoleMarkers[holeIdx + 1].index
                            : activeChart.data.labels.length - 1;
                        const holeWindow = nextHoleIdx - holeMarker.index;
                        const spread = Math.max(1, Math.floor(holeWindow / (holeShots.length + 1)));
                        timelineIdx = holeMarker.index + (shotOrderInHole + 1) * spread;
                    }
                }
            }

            // Initialize feature arrays for this hole
            if (!shotLines[hole]) {
                shotLines[hole] = [];
                shotOrigins[hole] = [];
                shotDests[hole] = [];
                shotLabels[hole] = [];
            }
            if (idx === 0) console.log('First shot initialized');

        // Build popup content
        const shotIdxInHole = holeShotIdx[hole] ?? 0;
        holeShotIdx[hole] = shotIdxInHole + 1;
        const dist = shot.distance_meters ? `${Math.round(shot.distance_meters * 1.09361)}yds` : '';
        const hr = shot.heart_rate ? `${shot.heart_rate}bpm` : '';
        const alt = shot.altitude_meters ? `${mToFt(shot.altitude_meters)}ft alt` : '';
        // Elevation change: shot altitude vs landing altitude (or green for approach shots)
        let elevHtml = '';
        if (shot.altitude_meters != null) {
            const holeShots = sc.hole_scores.find(h => String(h.hole_number) === hole)?.shots;
            let targetAlt = null;

            // Try to get next shot's altitude first
            if (holeShots && shotIdxInHole + 1 < holeShots.length) {
                const nextShot = holeShots[shotIdxInHole + 1];
                targetAlt = nextShot?.altitude_meters ?? null;
            }

            // If next shot has no altitude, use green elevation as fallback
            if (targetAlt == null && greenElevMap[hole] != null) {
                targetAlt = greenElevMap[hole];
            }

            if (targetAlt != null) {
                const diff = Math.round(targetAlt - shot.altitude_meters);
                if (diff !== 0) elevHtml = `${diff > 0 ? '↑' : '↓'}${mToFt(Math.abs(diff))}ft`;
                else elevHtml = 'Flat';
            }
        }
        const sgVal = sgLookup[`${hole}-${shotIdxInHole}`];
        const lieData = lieAngles[`${hole}-${shotIdxInHole}`];
        let dirHtml = '';
        if (!isPutt && holeGreenCenters[hole] != null) {
            const shotBear = bearing(shot.from, shot.to);
            const greenBear = bearing(shot.from, holeGreenCenters[hole]);
            dirHtml = dirArrowSvg(deviation(shotBear, greenBear));
        }
        const spark = hr ? hrSparkline(shot, round.health_timeline) : '';
        const leftLines = [
            `<b>H${hole} ${isPutt ? 'Putt' : `Shot ${shotNum}`}</b>`,
            `Club: ${club}`,
            dist ? `Dist: ${dist}` : null,
            elevHtml ? `Elev: ${elevHtml}` : null,
            lieData ? `Lie: ${lieData.label}` : null,
            isPutt ? `Putts: ${holePutts[hole] ?? '?'}` : null,
            alt ? `Alt: ${alt}` : null,
            shot.swing_tempo != null ? `Tempo: ${shot.swing_tempo.toFixed(1)}:1` : null,
            sgVal != null ? `SG: ${sgBadge(sgVal)}` : null,
        ].filter(Boolean).join('<br>');
        const rightParts = [dirHtml, hr ? `<div style="text-align:center;font-size:11px;color:#666">${hr}</div>${spark}` : ''].filter(Boolean).join('');
        const popupHtml = rightParts
            ? `<div style="display:flex;gap:10px;align-items:flex-start">
                <div style="flex:1;font-size:12px;line-height:1.6">${leftLines}</div>
                <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">${rightParts}</div>
               </div>`
            : `<div style="font-size:12px;line-height:1.6">${leftLines}</div>`;

        // Polyline (shot trajectory)
        shotLines[hole].push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[shot.from.lon, shot.from.lat], [shot.to.lon, shot.to.lat]] },
            properties: { color, isPutt, popupHtml, timelineIdx }
        });

        // Origin circle
        shotOrigins[hole].push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [shot.from.lon, shot.from.lat] },
            properties: { color, isPutt, popupHtml, timelineIdx }
        });

        // Destination circle (skip for putts)
        if (!isPutt) {
            shotDests[hole].push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [shot.to.lon, shot.to.lat] },
                properties: { color, isPutt }
            });
        }

        // Labels (club abbr + distance)
        const abbr = clubAbbr(shot);
        shotLabels[hole].push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [shot.from.lon, shot.from.lat] },
            properties: { label: abbr, color, isPutt, popupHtml, timelineIdx }
        });

        if (!isPutt && shot.distance_meters) {
            const mid = [(shot.from.lon + shot.to.lon) / 2, (shot.from.lat + shot.to.lat) / 2];
            const yds = Math.round(shot.distance_meters * 1.09361);
            shotLabels[hole].push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: mid },
                properties: { label: `${yds}y`, color: '#111827', isPutt, popupHtml, timelineIdx }
            });
            }
        });
    } catch (err) {
        console.error('[shotmap] Error building shot features at index', featureIdx, 'shot =', JSON.stringify(allShots[featureIdx]), err.message, err.stack);
    }
    console.log('[shotmap] features built', { shots: allShots.length, featureIdx, holes: Object.keys(shotLines).map(h => ({ hole: h, lines: shotLines[h].length, origins: shotOrigins[h].length, labels: shotLabels[h].length })) });

    console.log('Feature building complete. shotLines holes:', Object.keys(shotLines), 'total allShots:', allShots.length);

    // Create Maplibre sources and layers for each hole
    console.log('Creating sources/layers for holes:', Object.keys(shotLines));
    Object.entries(shotLines).forEach(([hole, features]) => {
        console.log(`Adding layer for hole ${hole}, features:`, features.length);
        // Polylines
        activeMap.addSource(`lines-${hole}`, { type: 'geojson', data: { type: 'FeatureCollection', features } });
        activeMap.addLayer({
            id: `lines-${hole}`,
            type: 'line',
            source: `lines-${hole}`,
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['case', ['get', 'isPutt'], 1.5, 2.5],
                'line-opacity': 0.85
            },
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            }
        });
        // Set dasharray per feature after layer is added
        if (features.some(f => f.properties.isPutt)) {
            activeMap.setPaintProperty(`lines-${hole}`, 'line-dasharray', ['case', ['get', 'isPutt'], ['literal', [4, 4]], ['literal', []]]);
        }
        holeLayers[hole].push(`lines-${hole}`);
        allLayerIds.add(`lines-${hole}`);

        // Origins (large circles with white stroke to fit club abbreviations)
        activeMap.addSource(`origins-${hole}`, { type: 'geojson', data: { type: 'FeatureCollection', features: shotOrigins[hole] } });
        activeMap.addLayer({
            id: `origins-${hole}`,
            type: 'circle',
            source: `origins-${hole}`,
            paint: {
                'circle-radius': ['case', ['get', 'isPutt'], 10, 14],
                'circle-color': ['get', 'color'],
                'circle-stroke-color': 'white',
                'circle-stroke-width': 2.5
            }
        });
        holeLayers[hole].push(`origins-${hole}`);
        allLayerIds.add(`origins-${hole}`);


        // Club abbreviation labels (centered on shot circles)
        console.log('[shotmap] layers hole', hole, 'labelFeatures', shotLabels[hole]?.length ?? 0, 'originFeatures', shotOrigins[hole]?.length ?? 0);
        if (shotLabels[hole]?.length) {
            const clubLabels = shotLabels[hole].filter(f => !/^\d+y$/.test(f.properties.label));
            if (clubLabels.length) {
                activeMap.addSource(`club-labels-${hole}`, { type: 'geojson', data: { type: 'FeatureCollection', features: clubLabels } });
                activeMap.addLayer({
                    id: `club-labels-${hole}`,
                    type: 'symbol',
                    source: `club-labels-${hole}`,
                    layout: {
                        'text-field': ['get', 'label'],
                        'text-size': 14,
                        'text-offset': [0, 0],
                        'text-allow-overlap': true
                    },
                    paint: {
                        'text-color': '#fff'
                    }
                });
                holeLabelLayers[hole].push(`club-labels-${hole}`);
                allLayerIds.add(`club-labels-${hole}`);
            }

            // Distance labels (below shots)
            const distLabels = shotLabels[hole].filter(f => /^\d+y$/.test(f.properties.label));
            if (distLabels.length) {
                activeMap.addSource(`dist-labels-${hole}`, { type: 'geojson', data: { type: 'FeatureCollection', features: distLabels } });
                activeMap.addLayer({
                    id: `dist-labels-${hole}`,
                    type: 'symbol',
                    source: `dist-labels-${hole}`,
                    layout: {
                        'text-field': ['get', 'label'],
                        'text-size': 12,
                        'text-offset': [0, 1.5],
                        'text-allow-overlap': false
                    },
                    paint: {
                        'text-color': '#111827',
                        'text-halo-color': '#fff',
                        'text-halo-width': 1
                    }
                });
                holeLabelLayers[hole].push(`dist-labels-${hole}`);
                allLayerIds.add(`dist-labels-${hole}`);
            }
        }
    });

    // Track current popup to close it when opening a new one
    let currentPopup = null;

    // Attach popup handlers to all layers
    allLayerIds.forEach(layerId => {
        activeMap.on('click', layerId, (e) => {
            if (e.features?.[0]?.properties?.popupHtml) {
                // Close previous popup
                if (currentPopup) currentPopup.remove();

                currentPopup = new maplibregl.Popup({ closeButton: true, maxWidth: 300 })
                    .setLngLat(e.lngLat)
                    .setHTML(e.features[0].properties.popupHtml)
                    .addTo(activeMap);
                // Clear shot indicator when popup closes
                currentPopup.on('close', () => {
                    clearShotIndicator();
                    currentPopup = null;
                });
                // Show shot timing line on timeline when popup opens
                if (e.features[0].properties.timelineIdx !== undefined && e.features[0].properties.timelineIdx !== null) {
                    showShotOnTimeline(e.features[0].properties.timelineIdx);
                }
            }
        });
        activeMap.on('mouseenter', layerId, (e) => {
            activeMap.getCanvas().style.cursor = 'pointer';
            if (e?.features?.[0]?.properties?.timelineIdx !== undefined && e?.features?.[0]?.properties?.timelineIdx !== null) {
                showShotOnTimeline(e.features[0].properties.timelineIdx);
            }
        });
        activeMap.on('mouseleave', layerId, () => {
            activeMap.getCanvas().style.cursor = '';
            clearShotIndicator();
        });
    });

    // Create "all" mode layer with small circles for all shots
    const allShotsFeatures = allShots.map(shot => {
        const cat = shot.club_category ?? 'unknown';
        const color = CLUB_COLORS[cat] ?? CLUB_COLORS.unknown;
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [shot.from.lon, shot.from.lat] },
            properties: { color }
        };
    });

    activeMap.addSource('all-shots', { type: 'geojson', data: { type: 'FeatureCollection', features: allShotsFeatures } });
    activeMap.addLayer({
        id: 'all-shots',
        type: 'circle',
        source: 'all-shots',
        paint: {
            'circle-radius': 3,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.8
        }
    });
    allLayerIds.add('all-shots');

    // Putt count text at green
    const puttLabels = [];
    sc.hole_scores.forEach(hs => {
        if (!hs.shots.length || !hs.putts) return;
        const lastShot = hs.shots[hs.shots.length - 1];
        const greenPos = lastShot.to;
        if (!greenPos || (greenPos.lat === lastShot.from.lat && greenPos.lon === lastShot.from.lon)) return;
        const label = hs.putts === 1 ? '1 putt' : `${hs.putts} putts`;
        puttLabels.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [greenPos.lon, greenPos.lat] },
            properties: { label }
        });
    });

    if (puttLabels.length) {
        activeMap.addSource('putt-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: puttLabels } });
        activeMap.addLayer({
            id: 'putt-labels',
            type: 'symbol',
            source: 'putt-labels',
            layout: {
                'text-field': ['get', 'label'],
                'text-size': 14,
                'text-offset': [0, -1.5],
                'text-allow-overlap': true
            },
            paint: {
                'text-color': '#1f2937',
                'text-halo-color': '#fff',
                'text-halo-width': 1
            }
        });
    }

    // GPS trail layer from health_timeline
    const trailPts = round.health_timeline
        .filter(s => s.position?.lat && s.position?.lon)
        .map(s => [s.position.lon, s.position.lat]);
    const hasTrail = trailPts.length > 1;
    if (hasTrail) {
        activeMap.addSource('trail', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trailPts } }
        });
        activeMap.addLayer({
            id: 'trail',
            type: 'line',
            source: 'trail',
            paint: { 'line-color': '#6366f1', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [4, 4] },
            layout: { 'line-join': 'round', 'line-cap': 'round' }
        });
        activeMap.setLayoutProperty('trail', 'visibility', 'none');
    }

    // Legend
    const usedCats = [...new Set(allShots.map(s => s.club_category ?? 'unknown'))];
    const catLabels = { tee:'Driver/Tee', fairway_wood:'Fairway Wood', iron:'Iron',
                        wedge:'Wedge', putt:'Putter', unknown:'Unknown' };
    document.getElementById('shot-legend').innerHTML = usedCats.map(cat => `
        <span class="flex items-center gap-1">
            <span style="background:${CLUB_COLORS[cat]};width:12px;height:12px;
                border-radius:50%;display:inline-block"></span>
            ${catLabels[cat] ?? cat}
        </span>`).join('');

    // Trail toggle
    let trailVisible = false;
    const trailBtn = document.getElementById('trail-toggle');
    if (trailBtn && hasTrail) {
        trailBtn.addEventListener('click', () => {
            trailVisible = !trailVisible;
            activeMap.setLayoutProperty('trail', 'visibility', trailVisible ? 'visible' : 'none');
            if (trailVisible) {
                trailBtn.classList.add('bg-indigo-100', 'border-indigo-400', 'text-indigo-700');
                trailBtn.classList.remove('border-gray-300');
            } else {
                trailBtn.classList.remove('bg-indigo-100', 'border-indigo-400', 'text-indigo-700');
                trailBtn.classList.add('border-gray-300');
            }
        });
    } else if (trailBtn && !hasTrail) {
        trailBtn.disabled = true;
        trailBtn.classList.add('opacity-40');
    }

    // Zoom to hole with rotation (tee→green bearing) — matching iOS implementation
    function zoomToHole(hole, animated = true) {
        if (hole === 'all') {
            activeMap.fitBounds(bounds, { padding: 100, duration: animated ? 1000 : 0 });
            return;
        }

        const holeShots = allShots.filter(s => String(s.hole_number) === hole);
        if (!holeShots.length) return;

        // Get tee and green (first and last shots)
        const firstShot = holeShots[0];
        const lastShot = holeShots[holeShots.length - 1];
        const tee = firstShot.from;
        const green = lastShot.to;

        // Center between tee and green (iOS approach)
        const center = [(tee.lon + green.lon) / 2, (tee.lat + green.lat) / 2];

        // Calculate altitude like iOS: max(distance * 3.5, 200)
        const dist = distMeters(tee, green);
        const altitude = Math.max(dist * 3.5, 200);

        // Convert altitude to zoom: simpler direct mapping (zoomed in ~2.5 levels more than iOS)
        // altitude ~200m → zoom ~19, altitude ~600m → zoom ~17.4, altitude ~2000m → zoom ~15.7
        const zoom = 19 - Math.log2(altitude / 200);

        // Bearing from tee to green
        const bear = bearing(tee, green);

        activeMap.easeTo({
            center: center,
            zoom: zoom,
            bearing: bear,
            duration: animated ? 1000 : 0
        });
    }

    // Hole filter buttons
    document.querySelectorAll('.hole-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Close any open popup
            if (currentPopup) {
                currentPopup.remove();
                currentPopup = null;
            }

            document.querySelectorAll('.hole-btn').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                b.classList.add('border-gray-300');
            });
            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            btn.classList.remove('border-gray-300');

            const holeFilter = btn.dataset.hole;

            if (holeFilter === 'all') {
                // "all" mode: show only small shot circles, hide per-hole layers
                Object.entries(holeLayers).forEach(([holeNum, layerIds]) => {
                    layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', 'none'));
                });
                Object.entries(holeLabelLayers).forEach(([holeNum, layerIds]) => {
                    layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', 'none'));
                });
                activeMap.setLayoutProperty('all-shots', 'visibility', 'visible');
                if (activeMap.getLayer('putt-labels')) {
                    activeMap.setLayoutProperty('putt-labels', 'visibility', 'none');
                }
            } else {
                // Individual hole mode: show per-hole layers, hide all-shots
                Object.entries(holeLayers).forEach(([holeNum, layerIds]) => {
                    const show = holeNum === holeFilter;
                    layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none'));
                });
                Object.entries(holeLabelLayers).forEach(([holeNum, layerIds]) => {
                    const show = holeNum === holeFilter;
                    layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none'));
                });
                activeMap.setLayoutProperty('all-shots', 'visibility', 'none');
                if (activeMap.getLayer('putt-labels')) {
                    activeMap.setLayoutProperty('putt-labels', 'visibility', 'visible');
                }
            }

            // Zoom with bearing (tee→green rotation)
            zoomToHole(holeFilter, true);

            // Zoom timeline chart to hole time window
            zoomTimeline(holeFilter);

            onShotMapHoleSelected(holeFilter);
            console.log('[shotmap] select hole', holeFilter, 'club-label visibility', Object.entries(holeLabelLayers).map(([h, ids]) => [h, ids.map(id => activeMap.getLayoutProperty(id, 'visibility'))]));
        });
        });

        // Initialize to "all" mode on map load
        Object.entries(holeLayers).forEach(([holeNum, layerIds]) => {
            layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', 'none'));
        });
        Object.entries(holeLabelLayers).forEach(([holeNum, layerIds]) => {
            layerIds.forEach(id => activeMap.setLayoutProperty(id, 'visibility', 'none'));
        });
        activeMap.setLayoutProperty('all-shots', 'visibility', 'visible');
        if (activeMap.getLayer('putt-labels')) {
            activeMap.setLayoutProperty('putt-labels', 'visibility', 'none');
        }
        console.log('[shotmap] load complete', { restoreHole, hole: shotMapUi.hole, layerIds: Object.keys(holeLabelLayers).length });
        if (restoreHole) document.querySelector(`.hole-btn[data-hole="${restoreHole}"]`)?.click();
    }); // END activeMap.on('load')

    // Ensure map properly sizes itself after layout changes
    requestAnimationFrame(() => {
        activeMap.resize();
    });
}

// ── Course Stats ─────────────────────────────────────────────────────────────

function bearing(from, to) {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat   * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distMeters(from, to) {
    const R = 6371000;
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(from.lat*Math.PI/180) * Math.cos(to.lat*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function metersToYards(m) { return m * 1.09361; }

// Bearing deviation: positive = right of target, negative = left
function deviation(shotBearing, holeBearing) {
    let d = shotBearing - holeBearing;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function dirLabel(dev) {
    if (Math.abs(dev) < 10) return 'Straight';
    if (dev > 0) return dev > 30 ? 'Far Right' : 'Right';
    return dev < -30 ? 'Far Left' : 'Left';
}

function buildCourseStats(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) {
        return `<div class="bg-white rounded-xl shadow-sm border p-6">
            <p class="text-gray-400 text-sm">${t('stats.nodata')}</p></div>`;
    }

    // Build enriched shot list with distance, bearing, deviation from green direction
    const enriched = [];
    const cachedElevGain = elevationGainCache[round.id] || {};
    sc.hole_scores.forEach(hs => {
        const holeDef = sc.hole_definitions.find(h => h.hole_number === hs.hole_number);
        const shots = hs.shots;
        if (!shots.length) return;

        // Green center = last shot destination
        const greenCenter = shots[shots.length - 1].to;

        shots.forEach((shot, idx) => {
            const dist = distMeters(shot.from, shot.to);
            const bear = bearing(shot.from, shot.to);
            const greenBear = bearing(shot.from, greenCenter);
            const dev  = deviation(bear, greenBear);
            enriched.push({
                hole:     hs.hole_number,
                par:      holeDef?.par ?? 0,
                shotIdx:  idx,
                shotNum:  idx + 1,
                totalShots: shots.length,
                club:     shot.club_name ?? 'Unknown',
                cat:      shot.club_category ?? 'unknown',
                dist,
                distYds:  metersToYards(dist),
                bearing:  bear,
                deviation: dev,
                dirLabel: dirLabel(dev),
                hr:       shot.heart_rate,
                alt:      shot.altitude_meters,
                elevGain: cachedElevGain[`${hs.hole_number}-${idx}`] ?? null,
            });
        });
    });

    const teeShots     = enriched.filter(s => s.cat === 'tee');
    const approachShots = enriched.filter(s => s.cat === 'fairway_wood' || s.cat === 'iron');
    const wedgeShots   = enriched.filter(s => s.cat === 'wedge');
    const putts        = enriched.filter(s => s.cat === 'putt');

    return `
    <div class="space-y-6">
        ${buildStatSection(t('stats.teeshots'), teeShots, true, round)}
        ${buildStatSection(t('stats.approach'), approachShots, false, round)}
        ${buildStatSection(t('stats.wedges'), wedgeShots, false, round)}
        ${buildPuttSection(putts, sc)}
        ${buildClubSummary(enriched)}
    </div>`;
}

function buildStatSection(title, shots, isTee, round) {
    if (!shots.length) return '';

    const avgDist = shots.reduce((a, s) => a + s.distYds, 0) / shots.length;
    const maxDist = Math.max(...shots.map(s => s.distYds));
    const straight = shots.filter(s => Math.abs(s.deviation) < 15).length;
    const right    = shots.filter(s => s.deviation >= 15).length;
    const left     = shots.filter(s => s.deviation <= -15).length;

    const dirBar = (count, total, color, label) => {
        if (!count) return '';
        const pct = (count / total * 100).toFixed(0);
        return `<div class="flex items-center gap-2 text-xs">
            <div class="w-12 text-right text-gray-500">${label}</div>
            <div class="flex-1 bg-gray-100 rounded-full h-3">
                <div class="${color} h-3 rounded-full" style="width:${pct}%"></div>
            </div>
            <div class="w-12 text-gray-600">${count} (${pct}%)</div>
        </div>`;
    };

    const rows = shots.map(s => {
        const spinner = '<svg class="inline w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
        const elevCellId = `elev-${s.hole}-${s.shotIdx}`;
        const elevStr = s.elevGain != null
            ? (s.elevGain === 0 ? 'Flat' : `${s.elevGain > 0 ? '↑' : '↓'}${mToFt(Math.abs(s.elevGain))}ft`)
            : '';
        const elevContent = elevStr || (s.cat !== 'putt' && s.alt != null ? spinner : '');
        const lieCellId = `lie-${s.hole}-${s.shotIdx}`;
        const lieContent = s.cat !== 'putt' ? spinner : '';
        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-1.5 text-xs text-gray-500">H${s.hole} S${s.shotNum}</td>
            <td class="py-1.5 text-xs">${s.club}</td>
            <td class="py-1.5 text-xs font-medium">${Math.round(s.distYds)} yds</td>
            <td class="py-1.5 text-xs">
                <span class="${
                    Math.abs(s.deviation) < 15 ? 'text-green-600' :
                    Math.abs(s.deviation) < 30 ? 'text-yellow-600' : 'text-red-600'
                }">${s.dirLabel}</span>
                <span class="text-gray-400 ml-1">(${s.deviation > 0 ? '+' : ''}${Math.round(s.deviation)}°)</span>
            </td>
            <td id="${elevCellId}" class="py-1.5 text-xs ${s.elevGain != null && s.elevGain > 0 ? 'text-red-500' : 'text-blue-500'}">${elevContent}</td>
            <td id="${lieCellId}" class="py-1.5 text-xs text-gray-500">${lieContent}</td>
            ${s.hr ? `<td class="py-1.5 text-xs text-gray-400">${s.hr} bpm</td>` : '<td></td>'}
        </tr>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${title}
            <span class="text-sm font-normal text-gray-400 ml-2">${shots.length} shots</span>
        </h3>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${Math.round(avgDist)}</div>
                <div class="text-xs text-gray-500">${t('stats.avg')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${Math.round(maxDist)}</div>
                <div class="text-xs text-gray-500">${t('stats.max')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${Math.round(straight / shots.length * 100)}%</div>
                <div class="text-xs text-gray-500">${t('stats.straight')}</div>
            </div>
        </div>
        <div class="space-y-1.5 mb-4">
            ${dirBar(left,     shots.length, 'bg-blue-400',   'Left')}
            ${dirBar(straight, shots.length, 'bg-green-400',  'Straight')}
            ${dirBar(right,    shots.length, 'bg-orange-400', 'Right')}
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">${t('stats.shot')}</th>
                    <th class="text-left py-1">${t('stats.club')}</th>
                    <th class="text-left py-1">${t('stats.dist')}</th>
                    <th class="text-left py-1">${t('stats.direction')}</th>
                    <th class="text-left py-1">Elev</th>
                    <th class="text-left py-1">Lie</th>
                    <th class="text-left py-1">${t('stats.hr')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function buildPuttSection(putts, sc) {
    if (!putts.length) return '';

    const totalPutts = sc.hole_scores.reduce((a, h) => a + h.putts, 0);
    const holesPlayed = sc.hole_scores.length;
    const onePutts = sc.hole_scores.filter(h => h.putts === 1).length;
    const threePutts = sc.hole_scores.filter(h => h.putts >= 3).length;

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('stats.putting.title')}
            <span class="text-sm font-normal text-gray-400 ml-2">${totalPutts} ${t('stats.putting.total')}</span>
        </h3>
        <div class="grid grid-cols-4 gap-4 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${(totalPutts / holesPlayed).toFixed(1)}</div>
                <div class="text-xs text-gray-500">${t('stats.putting.perhole')}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${onePutts}</div>
                <div class="text-xs text-gray-500">${t('stats.putting.oneputts')}</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-600">${totalPutts - onePutts - threePutts}</div>
                <div class="text-xs text-gray-500">${t('stats.putting.twoputts')}</div>
            </div>
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-xl font-bold text-red-600">${threePutts}</div>
                <div class="text-xs text-gray-500">${t('stats.putting.threeputts')}</div>
            </div>
        </div>
    </div>`;
}

function buildClubSummary(enriched) {
    // Group by club name, compute avg/max distance
    const byClub = {};
    enriched.filter(s => s.cat !== 'putt' && s.distYds > 5).forEach(s => {
        if (!byClub[s.club]) byClub[s.club] = [];
        byClub[s.club].push(s);
    });

    const clubs = Object.entries(byClub)
        .filter(([, shots]) => shots.length > 0 && shots[0].distYds > 5)
        .map(([name, shots]) => ({
            name,
            cat: shots[0].cat,
            count: shots.length,
            avg: shots.reduce((a, s) => a + s.distYds, 0) / shots.length,
            max: Math.max(...shots.map(s => s.distYds)),
            straight: shots.filter(s => Math.abs(s.deviation) < 15).length,
        }))
        .sort((a, b) => clubSortKey(a.name) - clubSortKey(b.name));

    const maxAvg = Math.max(...clubs.map(c => c.avg));

    const rows = clubs.map(c => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2 text-sm font-medium">${c.name}</td>
            <td class="py-2 text-xs text-gray-400">${c.count}</td>
            <td class="py-2">
                <div class="flex items-center gap-2">
                    <div class="w-24 bg-gray-100 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full" style="width:${(c.avg/maxAvg*100).toFixed(0)}%"></div>
                    </div>
                    <span class="text-sm font-medium">${Math.round(c.avg)} yds</span>
                </div>
            </td>
            <td class="py-2 text-xs text-gray-400">${Math.round(c.max)} yds</td>
            <td class="py-2 text-xs ${c.straight/c.count > 0.6 ? 'text-green-600' : 'text-gray-400'}">
                ${Math.round(c.straight/c.count*100)}%
            </td>
        </tr>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('stats.clubsummary')}</h3>
        <table class="w-full text-sm">
            <thead><tr class="text-xs text-gray-400 border-b">
                <th class="text-left py-1">${t('stats.club')}</th>
                <th class="text-left py-1">${t('scorecard.shots')}</th>
                <th class="text-left py-1">${t('stats.avgdist')}</th>
                <th class="text-left py-1">Max</th>
                <th class="text-left py-1">${t('stats.straightpct')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

// ── Strokes Gained (Broadie / Every Shot Counts) ─────────────────────────────

// Expected strokes tables by handicap level.
// Sources: Mark Broadie "Every Shot Counts" — scratch through 20-hcp amateur tables, interpolated.
// Each level: { tee, fairway, rough, green } arrays of [distance, expected_strokes].
const SG_BASELINES = {
    scratch: {
        tee: [[100,2.60],[150,2.70],[200,2.87],[250,3.08],[300,3.30],[350,3.52],[400,3.72],[450,3.93],[500,4.15],[550,4.38],[600,4.60]],
        fairway: [[20,2.30],[40,2.40],[60,2.52],[80,2.62],[100,2.72],[120,2.82],[140,2.94],[160,3.07],[180,3.20],[200,3.32],[225,3.48],[250,3.64]],
        rough: [[20,2.48],[40,2.58],[60,2.70],[80,2.80],[100,2.92],[120,3.04],[140,3.17],[160,3.30],[200,3.56],[250,3.90]],
        green: [[1,1.00],[2,1.00],[3,1.04],[4,1.10],[5,1.17],[6,1.25],[8,1.38],[10,1.48],[15,1.63],[20,1.74],[30,1.91],[50,2.14],[90,2.40]],
    },
    '5': {
        tee: [[100,2.66],[150,2.78],[200,2.97],[250,3.18],[300,3.40],[350,3.62],[400,3.82],[450,4.03],[500,4.25],[550,4.48],[600,4.70]],
        fairway: [[20,2.38],[40,2.48],[60,2.60],[80,2.70],[100,2.80],[120,2.90],[140,3.02],[160,3.15],[180,3.28],[200,3.40],[225,3.56],[250,3.72]],
        rough: [[20,2.55],[40,2.65],[60,2.78],[80,2.88],[100,2.99],[120,3.11],[140,3.24],[160,3.38],[200,3.64],[250,3.98]],
        green: [[1,1.00],[2,1.01],[3,1.06],[4,1.13],[5,1.21],[6,1.30],[8,1.44],[10,1.54],[15,1.70],[20,1.81],[30,1.98],[50,2.22],[90,2.50]],
    },
    '10': {
        tee: [[100,2.72],[150,2.85],[200,3.06],[250,3.28],[300,3.50],[350,3.71],[400,3.90],[450,4.12],[500,4.33],[550,4.57],[600,4.80]],
        fairway: [[20,2.45],[40,2.55],[60,2.67],[80,2.76],[100,2.85],[120,2.96],[140,3.08],[160,3.21],[180,3.34],[200,3.46],[225,3.62],[250,3.78]],
        rough: [[20,2.60],[40,2.71],[60,2.84],[80,2.94],[100,3.04],[120,3.16],[140,3.29],[160,3.43],[200,3.69],[250,4.03]],
        green: [[1,1.00],[2,1.01],[3,1.07],[4,1.15],[5,1.24],[6,1.33],[8,1.47],[10,1.58],[15,1.73],[20,1.84],[30,2.03],[50,2.27],[90,2.55]],
    },
    '15': {
        tee: [[100,2.80],[150,2.95],[200,3.18],[250,3.42],[300,3.65],[350,3.87],[400,4.08],[450,4.30],[500,4.52],[550,4.76],[600,5.00]],
        fairway: [[20,2.56],[40,2.67],[60,2.80],[80,2.90],[100,3.00],[120,3.12],[140,3.25],[160,3.39],[180,3.52],[200,3.66],[225,3.83],[250,4.00]],
        rough: [[20,2.72],[40,2.84],[60,2.98],[80,3.10],[100,3.22],[120,3.35],[140,3.50],[160,3.65],[200,3.93],[250,4.30]],
        green: [[1,1.00],[2,1.02],[3,1.10],[4,1.20],[5,1.31],[6,1.42],[8,1.58],[10,1.70],[15,1.88],[20,2.00],[30,2.20],[50,2.46],[90,2.78]],
    },
    '20': {
        tee: [[100,2.90],[150,3.08],[200,3.33],[250,3.58],[300,3.83],[350,4.06],[400,4.28],[450,4.52],[500,4.75],[550,5.00],[600,5.25]],
        fairway: [[20,2.70],[40,2.82],[60,2.96],[80,3.08],[100,3.20],[120,3.34],[140,3.48],[160,3.63],[180,3.78],[200,3.93],[225,4.12],[250,4.30]],
        rough: [[20,2.88],[40,3.01],[60,3.16],[80,3.30],[100,3.44],[120,3.58],[140,3.74],[160,3.90],[200,4.22],[250,4.62]],
        green: [[1,1.00],[2,1.04],[3,1.14],[4,1.26],[5,1.39],[6,1.52],[8,1.70],[10,1.84],[15,2.04],[20,2.18],[30,2.40],[50,2.70],[90,3.05]],
    },
};

function getActiveSgBaseline() {
    return SG_BASELINES[state.settings?.sg_baseline] ?? SG_BASELINES['10'];
}

function sgBaselineLabel() {
    const v = state.settings?.sg_baseline ?? '10';
    return v === 'scratch' ? t('settings.sg.scratch') : t('settings.sg.handicap', { v });
}

function interpolateBaseline(table, dist) {
    if (dist <= table[0][0]) return table[0][1];
    if (dist >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let i = 0; i < table.length - 1; i++) {
        if (dist >= table[i][0] && dist <= table[i + 1][0]) {
            const t = (dist - table[i][0]) / (table[i + 1][0] - table[i][0]);
            return table[i][1] + t * (table[i + 1][1] - table[i][1]);
        }
    }
    return table[table.length - 1][1];
}

// Expected strokes from a position. lie: 'tee' | 'fairway' | 'rough' | 'green'
function expectedStrokes(distYards, lie) {
    const b = getActiveSgBaseline();
    if (lie === 'green') return interpolateBaseline(b.green, distYards * 3); // yards→feet
    if (lie === 'tee') return interpolateBaseline(b.tee, distYards);
    if (lie === 'rough') return interpolateBaseline(b.rough, distYards);
    return interpolateBaseline(b.fairway, distYards);
}

// Compute strokes gained for an entire round. Returns { shots: [...], categories: {...} }
function computeStrokesGained(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return null;

    const sgShots = [];
    sc.hole_scores.forEach(hs => {
        const holeDef = sc.hole_definitions.find(h => h.hole_number === hs.hole_number);
        const shots = hs.shots;
        if (!shots.length) return;

        const green = shots[shots.length - 1].to; // last shot destination = hole location

        shots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            const isPutt = cat === 'putt';
            const isLastShot = idx === shots.length - 1;

            // Distance from shot origin to green
            const distBefore = metersToYards(distMeters(shot.from, green));
            // Distance from shot destination to green
            const distAfter = isLastShot ? 0 : metersToYards(distMeters(shot.to, green));

            // Determine lie
            let lieBefore, lieAfter;
            if (idx === 0) {
                lieBefore = 'tee';
            } else if (isPutt) {
                lieBefore = 'green';
            } else if (distBefore < 50) {
                lieBefore = 'fairway'; // short game — treat as fairway
            } else {
                // Use fairway_hit flag for 2nd shot on par 4/5 (tee shot hit fairway)
                lieBefore = (idx === 1 && hs.fairway_hit) ? 'fairway' : 'rough';
            }

            if (isLastShot) {
                lieAfter = 'holed';
            } else {
                const nextCat = shots[idx + 1]?.club_category;
                lieAfter = nextCat === 'putt' ? 'green' : (lieBefore === 'tee' && hs.fairway_hit ? 'fairway' : 'fairway');
            }

            const expBefore = expectedStrokes(distBefore, lieBefore);
            const expAfter = isLastShot ? 0 : expectedStrokes(distAfter, lieAfter);
            // SG = expected_before - (1 + expected_after)
            const sg = expBefore - 1 - expAfter;

            // Categorize: off-tee, approach, short-game, putting
            let sgCat;
            if (isPutt) {
                sgCat = 'putting';
            } else if (idx === 0 && (holeDef?.par ?? 0) >= 4) {
                sgCat = 'off_tee';
            } else if (distBefore < 50) {
                sgCat = 'short_game';
            } else {
                sgCat = 'approach';
            }

            sgShots.push({
                hole: hs.hole_number,
                shotIdx: idx,
                shotNum: idx + 1,
                club: shot.club_name ?? cat,
                cat: sgCat,
                distBefore: Math.round(distBefore),
                distAfter: Math.round(distAfter),
                lieBefore,
                sg: +sg.toFixed(3),
                from: shot.from,
                to: shot.to,
            });
        });
    });

    // Aggregate by category
    const cats = { off_tee: 0, approach: 0, short_game: 0, putting: 0 };
    const catCounts = { off_tee: 0, approach: 0, short_game: 0, putting: 0 };
    sgShots.forEach(s => {
        if (cats[s.cat] !== undefined) {
            cats[s.cat] += s.sg;
            catCounts[s.cat]++;
        }
    });
    const total = Object.values(cats).reduce((a, b) => a + b, 0);

    return { shots: sgShots, categories: cats, catCounts, total };
}

// Build a per-shot SG lookup keyed by "hole-shotIdx" for shot map popups
function buildSgLookup(round) {
    const sg = computeStrokesGained(round);
    if (!sg) return {};
    const map = {};
    sg.shots.forEach(s => { map[`${s.hole}-${s.shotIdx}`] = s.sg; });
    return map;
}

function sgColor(val) {
    if (val >= 0.3) return '#16a34a';  // strong gain
    if (val >= 0)   return '#22c55e';  // slight gain
    if (val >= -0.3) return '#f97316'; // slight loss
    return '#ef4444';                  // strong loss
}

function sgBadge(val) {
    if (val == null) return '';
    const sign = val >= 0 ? '+' : '';
    const c = sgColor(val);
    return `<span style="color:${c};font-weight:600;font-size:11px">${sign}${val.toFixed(2)}</span>`;
}

function buildStrokesGainedTab(round) {
    const sg = computeStrokesGained(round);
    if (!sg) return `<div class="bg-white rounded-xl shadow-sm border p-6">
        <p class="text-gray-400 text-sm">${t('sg.nodata')}</p></div>`;

    // Build club stats for NLG context (reuse buildClubAnalysis logic inline)
    const _clubStats = (() => {
        const sc = round.scorecard;
        if (!sc?.hole_scores?.length) return [];
        const dirMap = {};
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
            shots.forEach((shot, idx) => {
                if ((shot.club_category ?? '') === 'putt') return;
                dirMap[`${hs.hole_number}-${idx}`] = {
                    dev: deviation(bearing(shot.from, shot.to), holeBear),
                    dist: metersToYards(distMeters(shot.from, shot.to)),
                };
            });
        });
        const byClub = {};
        sg.shots.forEach(s => {
            if (s.cat === 'putting') return;
            if (!byClub[s.club]) byClub[s.club] = [];
            const dir = dirMap[`${s.hole}-${s.shotIdx}`];
            byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
        });
        const _std = arr => arr.length < 2 ? 0 : Math.sqrt(arr.reduce((a,v) => a+(v - arr.reduce((x,y)=>x+y,0)/arr.length)**2, 0)/(arr.length-1));
        return Object.entries(byClub).filter(([,arr]) => arr.length >= 2).map(([name, arr]) => ({
            name, shots: arr.length,
            avgDist: arr.reduce((a,s)=>a+s.distYds,0)/arr.length,
            distStd: _std(arr.map(s=>s.distYds)),
            avgDev:  arr.reduce((a,s)=>a+s.dev,0)/arr.length,
            avgSg:   arr.reduce((a,s)=>a+s.sg,0)/arr.length,
        }));
    })();

    const _nlgCtx = buildAnalyticsContext(round, sg, _clubStats);
    const insightsCard = buildInsightsCard(_nlgCtx);

    const catLabels = {
        off_tee: t('sg.offtee'), approach: t('sg.approach'),
        short_game: t('sg.shortgame'), putting: t('sg.putting')
    };
    const catIcons = {
        off_tee: '🏌️', approach: '🎯', short_game: '⛳', putting: '🏁'
    };

    // Summary cards
    const totalCard = `
        <div class="bg-gray-50 rounded-lg p-4 text-center col-span-2 md:col-span-1">
            <div class="text-2xl font-bold" style="color:${sgColor(sg.total)}">
                ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(1)}
            </div>
            <div class="text-xs text-gray-500 mt-1">${t('sg.total')}</div>
        </div>`;

    const catCards = Object.entries(catLabels).map(([key, label]) => {
        const val = sg.categories[key];
        const count = sg.catCounts[key];
        return `
        <div class="bg-gray-50 rounded-lg p-4 text-center">
            <div class="text-lg font-bold" style="color:${sgColor(val)}">
                ${val >= 0 ? '+' : ''}${val.toFixed(2)}
            </div>
            <div class="text-xs text-gray-500 mt-1">${catIcons[key]} ${label}</div>
            <div class="text-xs text-gray-400">${count} shots</div>
        </div>`;
    }).join('');

    // Category bar chart
    const maxAbs = Math.max(0.5, ...Object.values(sg.categories).map(Math.abs));
    const barChart = Object.entries(catLabels).map(([key, label]) => {
        const val = sg.categories[key];
        const pct = Math.abs(val) / maxAbs * 50;
        const isPos = val >= 0;
        return `
        <div class="flex items-center gap-3">
            <div class="w-24 text-xs text-gray-600 text-right">${label}</div>
            <div class="flex-1 flex items-center" style="height:24px">
                <div class="relative w-full bg-gray-100 rounded-full h-4">
                    <div class="absolute top-0 h-4 rounded-full" style="
                        background:${sgColor(val)};
                        width:${pct.toFixed(0)}%;
                        ${isPos ? 'left:50%' : `right:50%`}
                    "></div>
                    <div class="absolute top-0 left-1/2 w-px h-4 bg-gray-400"></div>
                </div>
            </div>
            <div class="w-16 text-xs font-medium text-right" style="color:${sgColor(val)}">
                ${val >= 0 ? '+' : ''}${val.toFixed(2)}
            </div>
        </div>`;
    }).join('');

    // Per-hole breakdown
    const holeMap = {};
    sg.shots.forEach(s => {
        if (!holeMap[s.hole]) holeMap[s.hole] = [];
        holeMap[s.hole].push(s);
    });

    const sc = round.scorecard;
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    const holeRows = sc.hole_scores.map(hs => {
        const shots = holeMap[hs.hole_number] || [];
        const holeSg = shots.reduce((a, s) => a + s.sg, 0);
        const def = parMap[hs.hole_number];
        const par = def?.par ?? 0;
        const diff = hs.score - par;
        const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);

        const shotCells = shots.map(s => `
            <div class="inline-flex items-center gap-1 mr-2 mb-1">
                <span class="text-xs text-gray-500">${s.club}</span>
                ${sgBadge(s.sg)}
            </div>`).join('');

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2 text-sm font-medium">H${hs.hole_number}</td>
            <td class="py-2 text-xs text-gray-500">P${par}</td>
            <td class="py-2 text-sm">${hs.score} <span class="text-xs text-gray-400">(${diffStr})</span></td>
            <td class="py-2 text-sm font-medium" style="color:${sgColor(holeSg)}">
                ${holeSg >= 0 ? '+' : ''}${holeSg.toFixed(2)}
            </td>
            <td class="py-2">${shotCells}</td>
        </tr>`;
    }).join('');

    // Best/worst shots
    const sorted = [...sg.shots].sort((a, b) => b.sg - a.sg);
    const best3 = sorted.slice(0, 3);
    const worst3 = sorted.slice(-3).reverse();

    const shotListHtml = (shots, label) => `
        <div>
            <div class="text-xs font-medium text-gray-500 mb-2">${label}</div>
            ${shots.map(s => `
                <div class="flex items-center justify-between py-1">
                    <span class="text-xs text-gray-600">H${s.hole} S${s.shotNum} · ${s.club} · ${s.distBefore}yds</span>
                    ${sgBadge(s.sg)}
                </div>`).join('')}
        </div>`;

    // Club analysis: merge SG shots with direction data
    const clubAnalysis = buildClubAnalysis(round, sg);
    const dispersion = buildDispersionHeatmaps(round, sg);

    return `
    ${insightsCard}
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('sg.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('sg.desc', { baseline: sgBaselineLabel() })}</p>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            ${totalCard}
            ${catCards}
        </div>
        <div class="space-y-2 mb-6">${barChart}</div>
        <div class="grid grid-cols-2 gap-6 mb-6">
            ${shotListHtml(best3, t('sg.bestshots'))}
            ${shotListHtml(worst3, t('sg.worstshots'))}
        </div>
    </div>
    ${clubAnalysis}
    ${dispersion}
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('sg.perhole')}</h3>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">Hole</th>
                    <th class="text-left py-1">Par</th>
                    <th class="text-left py-1">Score</th>
                    <th class="text-left py-1">SG</th>
                    <th class="text-left py-1">Shots</th>
                </tr></thead>
                <tbody>${holeRows}</tbody>
            </table>
        </div>
    </div>
    <div class="bg-gray-50 rounded-xl border border-gray-200 p-6 text-sm text-gray-500 leading-relaxed">
        <h4 class="font-semibold text-gray-600 mb-2">${t('sg.howworks.title')}</h4>
        <p class="mb-2">${t('sg.howworks.p1')}</p>
        <p class="mb-2">${t('sg.howworks.p2')}</p>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs">
            <div>${t('sg.howworks.offtee')}</div>
            <div>${t('sg.howworks.approach')}</div>
            <div>${t('sg.howworks.shortgame')}</div>
            <div>${t('sg.howworks.putting')}</div>
        </div>
        <p class="mt-3 text-xs text-gray-400">${t('sg.howworks.note')}</p>
    </div>`;
}

function buildClubAnalysis(round, sg) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return '';

    // Build direction data per shot keyed by hole-shotIdx
    const dirMap = {};
    sc.hole_scores.forEach(hs => {
        const shots = hs.shots;
        if (!shots.length) return;
        const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
        shots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            if (cat === 'putt') return;
            const dist = metersToYards(distMeters(shot.from, shot.to));
            const shotBear = bearing(shot.from, shot.to);
            const dev = deviation(shotBear, holeBear);
            dirMap[`${hs.hole_number}-${idx}`] = { dev, dist };
        });
    });

    // Group by club
    const byClub = {};
    sg.shots.forEach(s => {
        if (s.cat === 'putting') return;
        if (!byClub[s.club]) byClub[s.club] = [];
        const dir = dirMap[`${s.hole}-${s.shotIdx}`];
        byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
    });

    const stdDev = (arr) => {
        if (arr.length < 2) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / (arr.length - 1));
    };

    const clubs = Object.entries(byClub)
        .filter(([, shots]) => shots.length >= 2)
        .map(([name, shots]) => {
            const dists = shots.map(s => s.distYds);
            const devs = shots.map(s => s.dev);
            const sgs = shots.map(s => s.sg);
            const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
            const distStd = stdDev(dists);
            const avgDev = devs.reduce((a, b) => a + b, 0) / devs.length;
            const devStd = stdDev(devs);
            const avgSg = sgs.reduce((a, b) => a + b, 0) / sgs.length;
            const left = shots.filter(s => s.dev <= -15).length;
            const right = shots.filter(s => s.dev >= 15).length;
            const straight = shots.length - left - right;

            let tendency;
            if (Math.abs(avgDev) < 5) tendency = { label: 'Neutral', color: '#22c55e' };
            else if (avgDev < -5) tendency = { label: `Left bias (${Math.round(avgDev)}°)`, color: '#3b82f6' };
            else tendency = { label: `Right bias (+${Math.round(avgDev)}°)`, color: '#f97316' };

            // Consistency rating based on distance CV (coefficient of variation)
            const cv = avgDist > 0 ? distStd / avgDist : 0;
            let consistency;
            if (cv < 0.05) consistency = { label: 'Very consistent', color: '#16a34a', stars: '★★★' };
            else if (cv < 0.10) consistency = { label: 'Consistent', color: '#22c55e', stars: '★★☆' };
            else if (cv < 0.18) consistency = { label: 'Moderate', color: '#eab308', stars: '★☆☆' };
            else consistency = { label: 'Inconsistent', color: '#ef4444', stars: '☆☆☆' };

            return { name, shots: shots.length, avgDist, distStd, avgDev, devStd, avgSg, left, right, straight, tendency, consistency };
        })
        .sort((a, b) => clubSortKey(a.name) - clubSortKey(b.name));

    if (!clubs.length) return '';

    const rows = clubs.map(c => {
        const total = c.shots;
        const lPct = (c.left / total * 100).toFixed(0);
        const sPct = (c.straight / total * 100).toFixed(0);
        const rPct = (c.right / total * 100).toFixed(0);
        // Mini direction bar
        const dirBar = `<div class="flex h-3 rounded-full overflow-hidden" style="width:80px">
            <div class="bg-blue-400" style="width:${lPct}%"></div>
            <div class="bg-green-400" style="width:${sPct}%"></div>
            <div class="bg-orange-400" style="width:${rPct}%"></div>
        </div>`;

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 text-sm font-medium">${c.name}</td>
            <td class="py-2.5 text-xs text-gray-400 text-center">${c.shots}</td>
            <td class="py-2.5 text-sm">${Math.round(c.avgDist)} <span class="text-xs text-gray-400">±${Math.round(c.distStd)}</span></td>
            <td class="py-2.5"><span style="color:${c.consistency.color}" class="text-xs font-medium">${c.consistency.stars} ${c.consistency.label}</span></td>
            <td class="py-2.5">
                <div class="flex items-center gap-2">
                    ${dirBar}
                    <span class="text-xs" style="color:${c.tendency.color}">${c.tendency.label}</span>
                </div>
            </td>
            <td class="py-2.5 text-sm font-medium" style="color:${sgColor(c.avgSg)}">
                ${c.avgSg >= 0 ? '+' : ''}${c.avgSg.toFixed(2)}
            </td>
        </tr>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('clubanalysis.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('clubanalysis.desc')}</p>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">Club</th>
                    <th class="text-center py-1">Shots</th>
                    <th class="text-left py-1">Avg Dist</th>
                    <th class="text-left py-1">Consistency</th>
                    <th class="text-left py-1">Tendency</th>
                    <th class="text-left py-1">Avg SG</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function buildDispersionHeatmaps(round, sg) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return '';

    // Build enriched shot data with direction deviation and distance accuracy
    const shots = [];
    sc.hole_scores.forEach(hs => {
        const holeShots = hs.shots;
        if (!holeShots.length) return;
        const green = holeShots[holeShots.length - 1].to;
        const holeBear = bearing(holeShots[0].from, green);

        holeShots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            if (cat === 'putt') return;

            const distToGreenBefore = metersToYards(distMeters(shot.from, green));
            const distToGreenAfter = metersToYards(distMeters(shot.to, green));
            const shotDist = metersToYards(distMeters(shot.from, shot.to));
            const shotBear = bearing(shot.from, shot.to);
            const dev = deviation(shotBear, holeBear);

            // Distance accuracy: how far short/long of ideal
            // Ideal = land exactly on the line to green, covering distToGreenBefore yards
            // Positive = long, negative = short
            const idealDist = distToGreenBefore;
            const distDelta = shotDist - idealDist; // positive = long of target
            const distPct = idealDist > 0 ? (distDelta / idealDist) * 100 : 0;

            // Find matching SG
            const sgShot = sg.shots.find(s => s.hole === hs.hole_number && s.shotIdx === idx);

            shots.push({
                hole: hs.hole_number,
                club: shot.club_name ?? cat,
                cat,
                distToGreen: Math.round(distToGreenBefore),
                shotDist: Math.round(shotDist),
                dev,        // direction deviation in degrees
                distDelta,  // yards long(+) or short(-)
                distPct,    // % long/short
                sg: sgShot?.sg ?? 0,
            });
        });
    });

    if (!shots.length) return '';

    // Distance buckets
    const buckets = [
        { label: '0–50 yds',    min: 0,   max: 50 },
        { label: '51–100 yds',  min: 51,  max: 100 },
        { label: '101–150 yds', min: 101, max: 150 },
        { label: '151–200 yds', min: 151, max: 200 },
        { label: '200+ yds',    min: 201, max: 999 },
    ];

    // Direction bins and distance-result bins
    const dirBins = [
        { label: 'Far L',    min: -Infinity, max: -30 },
        { label: 'Left',     min: -30,       max: -10 },
        { label: 'Straight', min: -10,       max: 10 },
        { label: 'Right',    min: 10,        max: 30 },
        { label: 'Far R',    min: 30,        max: Infinity },
    ];
    const distBins = [
        { label: 'Way Long',  min: 15,        max: Infinity },
        { label: 'Long',      min: 5,         max: 15 },
        { label: 'Good',      min: -5,         max: 5 },
        { label: 'Short',     min: -15,        max: -5 },
        { label: 'Way Short', min: -Infinity,  max: -15 },
    ];

    function classify(val, bins) {
        for (const b of bins) {
            if (val >= b.min && val < b.max) return b.label;
        }
        return bins[bins.length - 1].label;
    }

    // Build heatmaps per bucket
    const heatmaps = buckets.map(bucket => {
        const bucketShots = shots.filter(s => s.distToGreen >= bucket.min && s.distToGreen <= bucket.max);
        if (bucketShots.length < 2) return null;

        // Build grid: distBin rows × dirBin cols
        const grid = {};
        distBins.forEach(db => {
            grid[db.label] = {};
            dirBins.forEach(dirB => {
                grid[db.label][dirB.label] = { count: 0, sgSum: 0 };
            });
        });

        bucketShots.forEach(s => {
            const dirLabel = classify(s.dev, dirBins);
            const distLabel = classify(s.distPct, distBins);
            grid[distLabel][dirLabel].count++;
            grid[distLabel][dirLabel].sgSum += s.sg;
        });

        const maxCount = Math.max(1, ...Object.values(grid).flatMap(row =>
            Object.values(row).map(c => c.count)
        ));

        // Render grid as HTML table
        const headerCells = dirBins.map(d =>
            `<th class="px-1 py-1 text-center" style="min-width:52px">${d.label}</th>`
        ).join('');

        const bodyRows = distBins.map(db => {
            const cells = dirBins.map(dirB => {
                const cell = grid[db.label][dirB.label];
                if (cell.count === 0) return `<td class="px-1 py-1 text-center"><span class="text-gray-200">·</span></td>`;
                const avgSg = cell.sgSum / cell.count;
                const intensity = cell.count / maxCount;
                // Blue intensity for count, text color for SG
                const bg = `rgba(59,130,246,${(0.08 + intensity * 0.5).toFixed(2)})`;
                const isGood = db.label === 'Good' && dirB.label === 'Straight';
                return `<td class="px-1 py-1 text-center" style="background:${bg};border-radius:4px">
                    <div class="text-sm font-bold" style="color:${sgColor(avgSg)}">${cell.count}</div>
                    <div class="text-xs" style="color:${sgColor(avgSg)}">${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(1)}</div>
                </td>`;
            }).join('');
            return `<tr><td class="px-2 py-1 text-xs text-gray-500 text-right font-medium whitespace-nowrap">${db.label}</td>${cells}</tr>`;
        }).join('');

        const avgSgBucket = bucketShots.reduce((a, s) => a + s.sg, 0) / bucketShots.length;

        return `
        <div>
            <div class="flex items-center gap-2 mb-2">
                <span class="text-sm font-medium text-gray-700">${bucket.label}</span>
                <span class="text-xs text-gray-400">${bucketShots.length} shots</span>
                <span class="text-xs font-medium" style="color:${sgColor(avgSgBucket)}">avg SG ${avgSgBucket >= 0 ? '+' : ''}${avgSgBucket.toFixed(2)}</span>
            </div>
            <table class="text-xs">
                <thead><tr><th></th>${headerCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>`;
    }).filter(Boolean);

    if (!heatmaps.length) return '';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('dispersion.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('dispersion.desc')}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            ${heatmaps.join('')}
        </div>
        <div class="mt-4 flex items-center gap-4 text-xs text-gray-400">
            <span>Cell = shot count + avg SG</span>
            <span>Blue intensity = frequency</span>
            <span style="color:#22c55e">● Gained</span>
            <span style="color:#ef4444">● Lost</span>
        </div>
    </div>`;
}

// ── NLG Analytics Context ───────────────────────────────────────────────────
// Lives in app.js so it can access metersToYards, distMeters, bearing, deviation

function buildAnalyticsContext(round, sg, clubStats) {
    const sc = round.scorecard;
    if (!sc) return null;
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    const holesPlayed = sc.hole_scores.length;
    const onePutts    = sc.hole_scores.filter(h => h.putts === 1).length;
    const threePutts  = sc.hole_scores.filter(h => h.putts >= 3).length;
    const firHoles    = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) >= 4);
    const fir         = firHoles.length > 0
        ? Math.round(firHoles.filter(h => h.fairway_hit).length / firHoles.length * 100) : 0;
    const girCount    = sc.hole_scores.filter(h =>
        h.shots.length <= (parMap[h.hole_number]?.par ?? 0) - 2).length;
    const girPct      = Math.round(girCount / holesPlayed * 100);
    const missedGir   = sc.hole_scores.filter(h =>
        h.shots.length > (parMap[h.hole_number]?.par ?? 0) - 2);
    const scramblingPct = missedGir.length > 0
        ? Math.round(missedGir.filter(h => h.score <= (parMap[h.hole_number]?.par ?? 0)).length / missedGir.length * 100)
        : 100;
    const frontNineScore = sc.hole_scores.filter(h => h.hole_number <= 9).length >= 8
        ? sc.hole_scores.filter(h => h.hole_number <= 9).reduce((a, h) => a + h.score, 0) : null;
    const backNineScore  = sc.hole_scores.filter(h => h.hole_number > 9).length >= 8
        ? sc.hole_scores.filter(h => h.hole_number > 9).reduce((a, h) => a + h.score, 0) : null;
    const avgOverPar = holes => holes.length > 0
        ? holes.reduce((a, h) => a + h.score - (parMap[h.hole_number]?.par ?? 0), 0) / holes.length : null;
    const par3AvgOverPar = avgOverPar(sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 3));
    const par5AvgOverPar = avgOverPar(sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 5));
    let maxConsecutiveBogeys = 0, curStreak = 0;
    sc.hole_scores.forEach(h => {
        h.score > (parMap[h.hole_number]?.par ?? 0)
            ? maxConsecutiveBogeys = Math.max(maxConsecutiveBogeys, ++curStreak)
            : (curStreak = 0);
    });

    const health = round.health_timeline ?? [];
    const bbSamples = health.filter(s => s.body_battery != null).map(s => s.body_battery);
    const bbEnd   = bbSamples[bbSamples.length - 1] ?? null;
    const bbDrain = bbSamples.length > 1 ? bbSamples[0] - bbEnd : null;
    const stressSamples = health.filter(s => s.stress_proxy > 0).map(s => s.stress_proxy);
    const avgStress = stressSamples.length
        ? Math.round(stressSamples.reduce((a, b) => a + b, 0) / stressSamples.length) : null;
    const hrSamples = health.filter(s => s.heart_rate != null);
    const mid = Math.floor(hrSamples.length / 2);
    const earlyRoundHr = mid > 0 ? hrSamples.slice(0, mid).reduce((a, s) => a + s.heart_rate, 0) / mid : null;
    const lateRoundHr  = mid > 0 ? hrSamples.slice(mid).reduce((a, s) => a + s.heart_rate, 0) / (hrSamples.length - mid) : null;

    const worstClub = clubStats?.length ? [...clubStats].sort((a, b) => a.avgSg - b.avgSg)[0] : null;
    const bestClub  = clubStats?.length ? [...clubStats].sort((a, b) => b.avgSg - a.avgSg)[0] : null;
    const driverClub = clubStats?.find(c => /driver/i.test(c.name)) ?? null;
    const wedgeClub  = clubStats?.filter(c => /pw|gw|sw|lw|wedge/i.test(c.name))
        .sort((a, b) => b.shots - a.shots)[0] ?? null;
    const ironClubs  = clubStats?.filter(c => /\d-iron|iron/i.test(c.name)) ?? [];
    const ironBias   = ironClubs.length
        ? ironClubs.reduce((a, c) => a + c.avgDev * c.shots, 0) / ironClubs.reduce((a, c) => a + c.shots, 0)
        : null;

    // Dispersion: find most-shot distance bucket
    let approachDispersion = null;
    const dispBuckets = [
        { label: '101–150 yds', min: 101, max: 150 }, { label: '151–200 yds', min: 151, max: 200 },
        { label: '51–100 yds', min: 51, max: 100 },   { label: '0–50 yds', min: 0, max: 50 },
        { label: '200+ yds', min: 201, max: 999 },
    ];
    for (const bucket of dispBuckets) {
        const deltas = [];
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const green = shots[shots.length - 1].to;
            shots.forEach(shot => {
                if ((shot.club_category ?? '') === 'putt') return;
                const d = metersToYards(distMeters(shot.from, green));
                if (d >= bucket.min && d <= bucket.max) {
                    const actual = metersToYards(distMeters(shot.from, shot.to));
                    deltas.push(d > 0 ? (actual - d) / d * 100 : 0);
                }
            });
        });
        if (deltas.length >= 3) {
            approachDispersion = {
                label: bucket.label,
                shortPct: Math.round(deltas.filter(p => p < -5).length / deltas.length * 100),
                longPct:  Math.round(deltas.filter(p => p > 5).length  / deltas.length * 100),
            };
            break;
        }
    }

    const allDevs = clubStats?.flatMap(c => Array(c.shots).fill(Math.abs(c.avgDev))) ?? [];
    const overallDispersionAngle = allDevs.length
        ? allDevs.reduce((a, b) => a + b, 0) / allDevs.length : null;

    const missBias = computeMissBiasPercentages(clubStats);

    return {
        round, sc, sg, clubStats,
        holesPlayed, onePutts, threePutts, fir, girPct, scramblingPct,
        frontNineScore, backNineScore, par3AvgOverPar, par5AvgOverPar, maxConsecutiveBogeys,
        bbEnd, bbDrain, avgStress, earlyRoundHr, lateRoundHr,
        durationMin: Math.round(round.duration_seconds / 60),
        distanceKm: +(round.distance_meters / 1000).toFixed(2),
        altRange: round.max_altitude_meters != null ? round.max_altitude_meters - round.min_altitude_meters : null,
        avgTempo: round.avg_swing_tempo ?? null,
        worstClub, bestClub, driverClub, wedgeClub, ironBias,
        approachDispersion, overallDispersionAngle,
        driverRightPct: missBias.driverRightPct ?? null,
        driverLeftPct: missBias.driverLeftPct ?? null,
        ironRightPct: missBias.ironRightPct ?? null,
        ironLeftPct: missBias.ironLeftPct ?? null,
        patterns: round._patterns ?? null,
        feedback: round._feedback ?? {},
    };
}

// ── AI Prompt Builder ────────────────────────────────────────────────────────

function buildAiPrompt(round) {
    const sc = round.scorecard;
    const dt = new Date((round.start_ts + GARMIN_EPOCH) * 1000);
    const dateStr = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const parMap = sc ? Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h])) : {};
    const scoredPar = sc ? sc.hole_scores.reduce((s, hs) => s + (parMap[hs.hole_number]?.par ?? 0), 0) : 0;
    const overPar = sc ? sc.total_score - scoredPar : 0;

    const L = [];
    L.push(t('ai.intro') + '\n');

    // Round summary
    L.push(t('ai.roundsummary'));
    L.push(`${t('ai.date')}: ${dateStr}`);
    L.push(`${t('ai.course')}: ${sc?.course_name ?? 'Unknown'} (${sc?.tee_color ?? ''} tees, Rating ${sc?.course_rating ?? ''}, Slope ${sc?.slope ?? ''})`);
    L.push(`${t('ai.score')}: ${sc?.total_score ?? '—'} (${overPar >= 0 ? '+' : ''}${overPar}) over par ${scoredPar}`);
    L.push(`${t('ai.holes')}: ${sc?.hole_scores.length ?? '—'}, ${t('ai.duration')}: ${Math.round(round.duration_seconds / 60)} min, ${t('ai.distance')}: ${(round.distance_meters / 1000).toFixed(2)} km`);
    const handStr = state.settings?.handedness === 'left' ? 'Left-handed' : 'Right-handed';
    L.push(`Handedness: ${handStr}`);
    L.push(`${t('ai.calories')}: ${round.calories ?? '—'}, ${t('ai.avghr')}: ${round.avg_heart_rate ?? '—'} bpm, ${t('ai.maxhr')}: ${round.max_heart_rate ?? '—'} bpm`);
    if (round.min_altitude_meters != null)
        L.push(`${t('ai.altitude')}: ${mToFt(round.min_altitude_meters)}–${mToFt(round.max_altitude_meters)} ft`);
    if (round.avg_swing_tempo != null)
        L.push(`${t('ai.avgtempo')}: ${round.avg_swing_tempo.toFixed(1)}:1`);

    // Scorecard
    if (sc) {
        L.push('\n' + t('ai.scorecard'));
        L.push(`${t('ai.sc.hole')} | ${t('ai.sc.par')} | ${t('ai.sc.score')} | ${t('ai.sc.diff')} | ${t('ai.sc.putts')} | ${t('ai.sc.fw')} | ${t('ai.sc.shots')} | ${t('ai.sc.clubs')}`);
        L.push('-----|-----|-------|-----|-------|----|-------|------');
        sc.hole_scores.forEach(hs => {
            const def = parMap[hs.hole_number];
            const par = def?.par ?? 0;
            const diff = hs.score - par;
            const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
            const fw = par === 3 ? t('ai.sc.na') : (hs.fairway_hit ? 'Y' : 'N');
            const clubs = [...new Set(hs.shots.filter(s => s.club_name).map(s => s.club_name))].join(', ') || '—';
            L.push(`H${hs.hole_number} | ${par} | ${hs.score} | ${diffStr} | ${hs.putts} | ${fw} | ${hs.shots.length} | ${clubs}`);
        });
        L.push(`${t('ai.sc.total')} | ${scoredPar} | ${sc.total_score} | ${overPar >= 0 ? '+' : ''}${overPar} | ${sc.total_putts} | ${sc.fairways_hit} FW | |`);
    }

    // Shot details
    if (sc) {
        L.push('\n' + t('ai.shotdetails'));
            const cachedElevGain = elevationGainCache[round.id] || {};
        sc.hole_scores.forEach(hs => {
            const def = parMap[hs.hole_number];
            const distYds = def?.distance_cm ? Math.round(def.distance_cm / 91.44) : '?';
            L.push(`\n${t('ai.sc.hole')} ${hs.hole_number} (Par ${def?.par ?? '?'}, ${distYds} yds):`);
            hs.shots.forEach((shot, i) => {
                const elevGain = shot.elevation_gain ?? cachedElevGain[`${hs.hole_number}-${i}`];
                const lie = shot.lie_angle ?? null;
                const elevStr = elevGain != null
                    ? (elevGain === 0 ? 'Flat' : `${elevGain > 0 ? '↑' : '↓'}${mToFt(Math.abs(elevGain))}ft`)
                    : null;
                const parts = [
                    `  ${t('ai.shot')} ${i+1}: ${shot.club_name ?? shot.club_category ?? 'Unknown'}`,
                    shot.distance_meters ? `${Math.round(shot.distance_meters * 1.09361)}yds` : null,
                    elevStr ? `Elev ${elevStr}` : null,
                    lie && lie.label ? `Lie ${lie.label}` : null,
                    shot.heart_rate      ? `HR ${shot.heart_rate}bpm` : null,
                    shot.altitude_meters ? `Alt ${mToFt(shot.altitude_meters)}ft` : null,
                    shot.swing_tempo     ? `Tempo ${shot.swing_tempo.toFixed(1)}:1` : null,
                ].filter(Boolean);
                L.push(parts.join(', '));
            });
        });
    }

    // NLG insights
    const _sg = computeStrokesGained(round);
    if (_sg) {
        const _ctx = buildAnalyticsContext(round, _sg, null);
        const insightsText = buildInsightsText(_ctx);
        if (insightsText) {
            L.push('\n' + t('ai.insights'));
            L.push(insightsText);
        }
    }

    // Strokes Gained summary
    const sg = computeStrokesGained(round);
    if (sg) {
        L.push('\n' + t('ai.sg'));
        L.push(`${t('ai.sg.total')}: ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(2)}`);
        const catNames = { off_tee: t('ai.sg.cats.off_tee'), approach: t('ai.sg.cats.approach'), short_game: t('ai.sg.cats.short_game'), putting: t('ai.sg.cats.putting') };
        Object.entries(catNames).forEach(([k, v]) => {
            const val = sg.categories[k];
            L.push(`${v}: ${val >= 0 ? '+' : ''}${val.toFixed(2)} (${sg.catCounts[k]} shots)`);
        });
        L.push(t('ai.sg.pershot'));
        L.push(`${t('ai.sg.hole')} | ${t('ai.shot')} | ${t('ai.sc.clubs')} | ${t('ai.sg.dist')} | SG`);
        L.push('-----|------|------|------|---');
        sg.shots.forEach(s => {
            L.push(`H${s.hole} | S${s.shotNum} | ${s.club} | ${s.distBefore}yds | ${s.sg >= 0 ? '+' : ''}${s.sg.toFixed(2)}`);
        });

        // Club analysis: tendency and consistency
        const sc = round.scorecard;
        if (sc?.hole_scores?.length) {
            const dirMap = {};
            sc.hole_scores.forEach(hs => {
                const shots = hs.shots;
                if (!shots.length) return;
                const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
                shots.forEach((shot, idx) => {
                    if ((shot.club_category ?? '') === 'putt') return;
                    const dev = deviation(bearing(shot.from, shot.to), holeBear);
                    const dist = metersToYards(distMeters(shot.from, shot.to));
                    dirMap[`${hs.hole_number}-${idx}`] = { dev, dist };
                });
            });

            const byClub = {};
            sg.shots.filter(s => s.cat !== 'putting').forEach(s => {
                if (!byClub[s.club]) byClub[s.club] = [];
                const dir = dirMap[`${s.hole}-${s.shotIdx}`];
                byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
            });

            const clubEntries = Object.entries(byClub).filter(([, arr]) => arr.length >= 2);
            if (clubEntries.length) {
                L.push('\n' + t('ai.clubanalysis'));
                L.push(`${t('ai.sc.clubs')} | ${t('ai.sc.shots')} | ${t('ai.club.avgdist')} | ${t('ai.club.stddev')} | ${t('ai.club.avgdev')} | ${t('ai.club.left')} | ${t('ai.club.straight')} | ${t('ai.club.right')} | ${t('ai.club.avgsg')}`);
                L.push('-----|-------|---------|---------|---------------|-------|-----------|--------|------');
                clubEntries.sort((a, b) => {
                    const avgA = a[1].reduce((s, x) => s + x.distYds, 0) / a[1].length;
                    const avgB = b[1].reduce((s, x) => s + x.distYds, 0) / b[1].length;
                    return avgB - avgA;
                }).forEach(([name, arr]) => {
                    const dists = arr.map(s => s.distYds);
                    const devs = arr.map(s => s.dev);
                    const avgDist = Math.round(dists.reduce((a, b) => a + b, 0) / dists.length);
                    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
                    const std = Math.round(Math.sqrt(dists.reduce((a, v) => a + (v - mean) ** 2, 0) / (dists.length - 1)));
                    const avgDev = Math.round(devs.reduce((a, b) => a + b, 0) / devs.length);
                    const left = Math.round(arr.filter(s => s.dev <= -15).length / arr.length * 100);
                    const right = Math.round(arr.filter(s => s.dev >= 15).length / arr.length * 100);
                    const straight = 100 - left - right;
                    const avgSg = (arr.reduce((a, s) => a + s.sg, 0) / arr.length);
                    L.push(`${name} | ${arr.length} | ${avgDist}yds | ±${std} | ${avgDev >= 0 ? '+' : ''}${avgDev}° | ${left}% | ${straight}% | ${right}% | ${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(2)}`);
                });
            }

            // Shot dispersion by distance bucket
            const allDispShots = [];
            sc.hole_scores.forEach(hs => {
                const shots = hs.shots;
                if (!shots.length) return;
                const green = shots[shots.length - 1].to;
                const holeBear = bearing(shots[0].from, green);
                shots.forEach((shot, idx) => {
                    if ((shot.club_category ?? '') === 'putt') return;
                    const distToGreen = metersToYards(distMeters(shot.from, green));
                    const shotDist = metersToYards(distMeters(shot.from, shot.to));
                    const dev = deviation(bearing(shot.from, shot.to), holeBear);
                    const distPct = distToGreen > 0 ? ((shotDist - distToGreen) / distToGreen) * 100 : 0;
                    const sgShot = sg.shots.find(s => s.hole === hs.hole_number && s.shotIdx === idx);
                    allDispShots.push({ distToGreen: Math.round(distToGreen), dev, distPct, sg: sgShot?.sg ?? 0 });
                });
            });

            const buckets = [
                { label: '0-50 yds', min: 0, max: 50 },
                { label: '51-100 yds', min: 51, max: 100 },
                { label: '101-150 yds', min: 101, max: 150 },
                { label: '151-200 yds', min: 151, max: 200 },
                { label: '200+ yds', min: 201, max: 999 },
            ];

            const dispBuckets = buckets.map(b => ({
                ...b, shots: allDispShots.filter(s => s.distToGreen >= b.min && s.distToGreen <= b.max)
            })).filter(b => b.shots.length >= 2);

            if (dispBuckets.length) {
                L.push('\n' + t('ai.dispersion'));
                dispBuckets.forEach(b => {
                    const avgSg = (b.shots.reduce((a, s) => a + s.sg, 0) / b.shots.length);
                    const avgDev = Math.round(b.shots.reduce((a, s) => a + s.dev, 0) / b.shots.length);
                    const avgDistPct = (b.shots.reduce((a, s) => a + s.distPct, 0) / b.shots.length).toFixed(1);
                    const left = b.shots.filter(s => s.dev <= -10).length;
                    const right = b.shots.filter(s => s.dev >= 10).length;
                    const short = b.shots.filter(s => s.distPct < -5).length;
                    const long = b.shots.filter(s => s.distPct > 5).length;
                    L.push(`\n${b.label} (${b.shots.length} shots, avg SG ${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(2)}):`);
                    L.push(`  ${t('ai.disp.direction')}: ${t('ai.disp.avg')} ${avgDev >= 0 ? '+' : ''}${avgDev}° | ${left} ${t('ai.disp.left')}, ${b.shots.length - left - right} ${t('ai.disp.straight')}, ${right} ${t('ai.disp.right')}`);
                    L.push(`  ${t('ai.disp.distance')}: ${t('ai.disp.avg')} ${avgDistPct}${t('ai.disp.oftarget')} | ${short} ${t('ai.disp.short')}, ${b.shots.length - short - long} ${t('ai.disp.good')}, ${long} ${t('ai.disp.long')}`);
                });
            }
        }
    }

    // Health summary + full timeline
    const health = round.health_timeline;
    if (health.length > 0) {
        const bbSamples = health.filter(s => s.body_battery != null).map(s => s.body_battery);
        const stressSamples = health.filter(s => s.stress_proxy != null && s.stress_proxy > 0).map(s => s.stress_proxy);
        L.push('\n' + t('ai.health'));
        if (bbSamples.length)
            L.push(`${t('ai.health.bb')}: ${bbSamples[0]}% → ${bbSamples[bbSamples.length-1]}% (${t('ai.health.drained')} ${bbSamples[0] - bbSamples[bbSamples.length-1]}%)`);
        if (stressSamples.length) {
            const avg = Math.round(stressSamples.reduce((a,b) => a+b,0) / stressSamples.length);
            L.push(`${t('ai.health.stress')}: ${t('ai.health.avg')} ${avg}, ${t('ai.health.peak')} ${Math.max(...stressSamples)}`);
        }

        // Downsample to ~1 sample per minute
        const totalSecs = health[health.length-1].timestamp - health[0].timestamp;
        const avgInterval = totalSecs / health.length || 4;
        const step = Math.max(1, Math.round(60 / avgInterval));
        const pts = health.filter((_, i) => i % step === 0);

        // Map tempo samples onto nearest health timestamp
        const tempoByTs = {};
        (round.tempo_timeline ?? []).forEach(t => {
            let best = null, bestDiff = Infinity;
            pts.forEach(s => { const d = Math.abs(s.timestamp - t.timestamp); if (d < bestDiff) { bestDiff = d; best = s.timestamp; } });
            if (best !== null) tempoByTs[best] = t.ratio;
        });

        L.push('\n' + t('ai.timeline'));
        L.push(`${t('ai.timeline.time')} | ${t('ai.timeline.hr')} | ${t('ai.timeline.alt')} | ${t('ai.timeline.stress')} | ${t('ai.timeline.tempo')}`);
        L.push('-----|----------|--------------|--------|------');
        pts.forEach(s => {
            const d = new Date((s.timestamp + GARMIN_EPOCH) * 1000);
            const locale = getLang() === 'ko' ? 'ko-KR' : 'en-US';
            const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
            const hr  = s.heart_rate ?? '-';
            const alt = s.altitude_meters != null ? Math.round(s.altitude_meters) : '-';
            const str = s.stress_proxy ?? '-';
            const tmp = tempoByTs[s.timestamp] != null ? `${tempoByTs[s.timestamp].toFixed(1)}:1` : '-';
            L.push(`${time} | ${hr} | ${alt} | ${str} | ${tmp}`);
        });
    }

    L.push('\n---');
    L.push(t('ai.closing'));
    return L.join('\n');
}

// ── Event handlers ───────────────────────────────────────────────────────────

function applySyncButtonVisibility() {
    const syncBtn   = document.getElementById('sync-btn');
    const appleSyncBtn = document.getElementById('apple-sync-btn');
    const androidSyncBtn = document.getElementById('android-sync-btn');
    if (state.settings?.device_source === 'apple') {
        syncBtn.classList.add('hidden');
        appleSyncBtn?.classList.remove('hidden');
        androidSyncBtn?.classList.add('hidden');
    } else if (state.settings?.device_source === 'android') {
        syncBtn.classList.add('hidden');
        appleSyncBtn?.classList.add('hidden');
        androidSyncBtn?.classList.remove('hidden');
    } else {
        syncBtn.classList.remove('hidden');
        appleSyncBtn?.classList.add('hidden');
        androidSyncBtn?.classList.add('hidden');
    }
}

async function renderSetupModal(isFirstRun) {
    const modal = document.getElementById('setup-modal');
    const name = state.settings?.player_name ?? '';
    const device = state.settings?.device_source ?? '';
    const lang = getLang();
    const sgBaseline = state.settings?.sg_baseline ?? '10';
    const excludeOutliers = state.settings?.exclude_outliers ?? true;
    const onDeviceCoaching = state.isAppleSilicon ? (state.settings?.on_device_coaching ?? true) : false;
    const handedness = state.settings?.handedness ?? 'right';
    const appVersion = await getAppVersion();

    modal.innerHTML = `
    <div class="modal-card">
        <div class="text-center mb-6">
            <div class="text-4xl mb-2">⛳</div>
            <h2 class="text-xl font-bold">
                <span class="text-red-500">Go</span><span class="text-blue-600">Birdie</span>
                ${!isFirstRun ? ` <span class="text-gray-400 font-normal text-base">${t('settings.title')}</span>` : ''}
            </h2>
            <p class="text-xs text-gray-400 mt-1">v${appVersion}</p>
            ${isFirstRun ? `<p class="text-sm text-gray-500 mt-1">${t('setup.subtitle')}</p>` : ''}
        </div>
        <div class="space-y-5">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">${t('setup.name')}</label>
                <input type="text" id="setup-name" value="${name}" placeholder="${t('setup.name.placeholder')}"
                    class="w-full p-2.5 border rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">${t('settings.handedness') || 'Handedness'}</label>
                <div class="flex gap-3">
                    <button class="hand-option flex-1 py-2 rounded-lg border text-sm font-medium transition
                        ${handedness === 'right' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}" data-hand="right">
                        ${t('settings.handedness.right') || 'Right-handed'}
                    </button>
                    <button class="hand-option flex-1 py-2 rounded-lg border text-sm font-medium transition
                        ${handedness === 'left' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}" data-hand="left">
                        ${t('settings.handedness.left') || 'Left-handed'}
                    </button>
                </div>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">${t('setup.device')}</label>
                <div class="grid grid-cols-3 gap-3">
                    <div class="device-option ${device === 'garmin' ? 'selected' : ''}" data-device="garmin">
                        <div class="device-icon">⌚</div>
                        <div class="device-name">${t('setup.device.garmin')}</div>
                        <div class="device-desc">${t('setup.device.garmin.desc')}</div>
                    </div>
                    <div class="device-option ${device === 'apple' ? 'selected' : ''}" data-device="apple">
                        <div class="device-icon">📱</div>
                        <div class="device-name">${t('setup.device.apple')}</div>
                        <div class="device-desc">${state.platform === 'windows' ? t('setup.device.apple.wifi') : t('setup.device.apple.desc')}</div>
                    </div>
                    <div class="device-option ${device === 'android' ? 'selected' : ''}" data-device="android">
                        <div class="device-icon">📱</div>
                        <div class="device-name">${t('setup.device.android')}</div>
                        <div class="device-desc">${t('setup.device.android.desc')}</div>
                    </div>
                </div>
            </div>
            ${!isFirstRun ? `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">${t('settings.language')}</label>
                <div class="flex gap-3">
                    <button class="lang-option flex-1 py-2 rounded-lg border text-sm font-medium transition
                        ${lang === 'en' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}" data-lang="en">
                        🇺🇸 English
                    </button>
                    <button class="lang-option flex-1 py-2 rounded-lg border text-sm font-medium transition
                        ${lang === 'ko' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}" data-lang="ko">
                        🇰🇷 한국어
                    </button>
                </div>
            </div>` : ''}
            ${!isFirstRun ? `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">${t('settings.sgbaseline')}</label>
                <div class="flex gap-2">
                    ${['scratch','5','10','15','20'].map(v => {
                        const label = v === 'scratch' ? t('settings.sg.scratch') : t('settings.sg.handicap', {v});
                        const active = sgBaseline === v;
                        return `<button class="sg-option flex-1 py-2 rounded-lg border text-xs font-medium transition
                            ${active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}" data-sg="${v}">
                            ${label}
                        </button>`;
                    }).join('')}
                </div>
                <p class="text-xs text-gray-400 mt-1">${t('settings.sgbaseline.desc')}</p>
            </div>` : ''}
            ${!isFirstRun ? `
            <div>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="setup-outliers" ${excludeOutliers ? 'checked' : ''}
                        class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                    <span class="text-sm font-medium text-gray-700">${t('settings.outliers')}</span>
                </label>
                <p class="text-xs text-gray-400 mt-1 ml-6">${t('settings.outliers.desc')}</p>
            </div>` : ''}
            ${!isFirstRun ? `
            <div>
                <label class="flex items-center gap-2 ${state.isAppleSilicon ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}" ${state.isAppleSilicon ? '' : `title="${t('settings.ondevice.unavailable')}"`}>
                    <input type="checkbox" id="setup-ondevice" ${onDeviceCoaching ? 'checked' : ''}
                        ${state.isAppleSilicon ? '' : 'disabled'}
                        class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                    <span class="text-sm font-medium text-gray-700">${t('settings.ondevice')}</span>
                </label>
                <p class="text-xs text-gray-400 mt-1 ml-6">${state.isAppleSilicon ? t('settings.ondevice.desc') : t('settings.ondevice.unavailable')}</p>
            </div>` : ''}
            <div id="setup-error" class="text-red-500 text-xs text-center hidden">${t('setup.validation')}</div>
            <button id="setup-save-btn"
                class="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition text-sm font-medium">
                ${isFirstRun ? t('setup.save') : t('settings.save')}
            </button>
        </div>
    </div>`;

    modal.classList.remove('hidden');

    let selectedDevice = device;
    let selectedLang = lang;
    let selectedSgBaseline = sgBaseline;
    let selectedHandedness = handedness;

    modal.querySelectorAll('.hand-option').forEach(el => {
        el.addEventListener('click', () => {
            modal.querySelectorAll('.hand-option').forEach(o => {
                o.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700');
                o.classList.add('border-gray-200', 'text-gray-600');
            });
            el.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700');
            el.classList.remove('border-gray-200', 'text-gray-600');
            selectedHandedness = el.dataset.hand;
        });
    });

    modal.querySelectorAll('.device-option').forEach(el => {
        el.addEventListener('click', () => {
            modal.querySelectorAll('.device-option').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected');
            selectedDevice = el.dataset.device;
        });
    });

    modal.querySelectorAll('.lang-option').forEach(el => {
        el.addEventListener('click', () => {
            modal.querySelectorAll('.lang-option').forEach(o => {
                o.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700');
                o.classList.add('border-gray-200', 'text-gray-600');
            });
            el.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700');
            el.classList.remove('border-gray-200', 'text-gray-600');
            selectedLang = el.dataset.lang;
        });
    });

    modal.querySelectorAll('.sg-option').forEach(el => {
        el.addEventListener('click', () => {
            modal.querySelectorAll('.sg-option').forEach(o => {
                o.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700');
                o.classList.add('border-gray-200', 'text-gray-600');
            });
            el.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700');
            el.classList.remove('border-gray-200', 'text-gray-600');
            selectedSgBaseline = el.dataset.sg;
        });
    });

    modal.querySelector('#setup-save-btn').addEventListener('click', async () => {
        const playerName = modal.querySelector('#setup-name').value.trim();
        if (!playerName || !selectedDevice) {
            modal.querySelector('#setup-error').classList.remove('hidden');
            return;
        }
        const outliers = modal.querySelector('#setup-outliers')?.checked ?? true;
        const onDevice = state.isAppleSilicon ? (modal.querySelector('#setup-ondevice')?.checked ?? true) : false;
        const settings = { player_name: playerName, device_source: selectedDevice, sg_baseline: selectedSgBaseline, exclude_outliers: outliers, on_device_coaching: onDevice, handedness: selectedHandedness };
        try {
            await saveSettings(settings);
            state.settings = settings;
            if (selectedLang !== getLang()) {
                setLang(selectedLang);
                onLangChange();
            }
            if (isSettingsWindow) {
                state._settingsDirty = false;
                await emit('settings-changed', { settings, language: selectedLang });
                await getCurrentWebviewWindow().destroy();
                return;
            }
            modal.classList.add('hidden');
            applySyncButtonVisibility();
            if (isFirstRun) {
                await loadInitialData();
            }
        } catch (e) {
            toast(`Settings save failed: ${e}`, true);
        }
    });

}

// ── Google Drive backup (settings) ───────────────────────────────────────────

let gdriveUnlisten = null;

function buildGDriveSection(gd) {
    const inputCls = 'w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm';
    const btnCls = 'px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed';
    return `
    <div class="border-t pt-4 space-y-3">
        <div>
            <h3 class="text-sm font-semibold text-gray-700">${t('gdrive.title')}</h3>
            <p class="text-xs text-gray-400 mt-1">${t('gdrive.desc')}</p>
        </div>
        <div>
            <label class="text-xs font-medium text-gray-600">${t('gdrive.clientId')}</label>
            <input id="gdrive-client-id" type="text" class="${inputCls}"
                placeholder="${gd.configured ? t('gdrive.configured') : ''}">
            <p class="text-xs text-gray-400 mt-1">${t('gdrive.clientId.hint')}</p>
        </div>
        <div>
            <label class="text-xs font-medium text-gray-600">${t('gdrive.clientSecret')}</label>
            <input id="gdrive-client-secret" type="password" class="${inputCls}">
        </div>
        <div class="flex items-center justify-between gap-2">
            <span id="gdrive-status" class="text-xs text-gray-500"></span>
            <button id="gdrive-connect-btn" data-connected="${gd.connected ? '1' : '0'}" class="${btnCls}"></button>
        </div>
        <p class="text-xs text-gray-400">${t('gdrive.reconnect')}</p>
        <div>
            <label class="text-xs font-medium text-gray-600">${t('gdrive.fileName')}</label>
            <input id="gdrive-file-name" type="text" class="${inputCls}" value="gobirdie-rounds-${todayLocalStr()}.json">
            <p class="text-xs text-gray-400 mt-1">${t('gdrive.folder')}</p>
        </div>
        <div class="flex items-center gap-2">
            <button id="gdrive-export-btn" class="${btnCls} flex-1">${t('gdrive.export')}</button>
            <button id="gdrive-import-btn" class="${btnCls} flex-1">${t('gdrive.chooseImport')}</button>
        </div>
        <p id="gdrive-result" class="hidden text-xs break-all"></p>
    </div>`;
}

// ── File & Google Drive backup (own dialog from the File menu) ──────────────

async function renderDriveModal() {
    const modal = document.getElementById('setup-modal');
    const gdStatus = await gdriveStatus().catch(() => ({ configured: false, connected: false }));
    modal.innerHTML = `
    <div class="modal-card">
        <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-gray-800">${t('gdrive.title')}</h2>
            <button id="backup-close" class="text-gray-400 hover:text-gray-600 text-xl leading-none" title="${t('file.close')}">×</button>
        </div>
        <div class="space-y-5">
            ${buildGDriveSection(gdStatus)}
        </div>
    </div>`;
    modal.classList.remove('hidden');
    modal.querySelector('#backup-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
    wireGDriveSection(modal);
}

// ── Local file backup (File menu) ────────────────────────────────────────────

function fileErrorText(e) {
    const keys = {
        file_invalid: 'file.err.invalid',
        file_newer: 'file.err.newer',
        file_too_large: 'file.err.too_large',
        file_write: 'file.err.write',
    };
    const code = String(e);
    return keys[code] ? t(keys[code]) : t('file.err.generic', { error: code });
}

// Export: save dialog (Rust). Cancelling does nothing.
async function exportToFile() {
    try {
        const r = await exportRoundsFile();
        if (!r) return;
        toast(t('file.export.done', { count: r.count, path: r.path }));
    } catch (e) {
        toast(fileErrorText(e), true);
    }
}

// Import: confirm and choose how to treat existing rounds, then file picker (Rust).
async function importFromFile() {
    const choice = await askChoice(t('file.confirm.import'), [
        { key: 'cancel', label: t('shotmap.edit.cancel') },
        { key: 'keep', label: t('file.import.keep') },
        { key: 'overwrite', label: t('file.import.overwrite'), primary: true },
    ]);
    if (choice !== 'keep' && choice !== 'overwrite') return;
    try {
        const r = await importRoundsFile(choice === 'overwrite');
        if (!r) return;
        toast(t('file.import.done', { imported: r.imported, skipped: r.skipped_existing + r.skipped_invalid }));
        state.rounds = await getAllRounds();
        renderRoundsList();
        updateStats();
    } catch (e) {
        toast(fileErrorText(e), true);
    }
}

// Maps a backend error code to a localized message.
function gdriveErrorText(e) {
    const keys = {
        gdrive_not_configured: 'gdrive.err.not_configured',
        gdrive_not_connected: 'gdrive.err.not_connected',
        gdrive_auth_revoked: 'gdrive.err.auth_revoked',
        gdrive_auth_timeout: 'gdrive.err.auth_timeout',
        gdrive_auth_denied: 'gdrive.err.auth_denied',
        gdrive_network: 'gdrive.err.network',
        gdrive_quota: 'gdrive.err.quota',
        gdrive_busy: 'gdrive.err.busy',
        gdrive_browser: 'gdrive.err.browser',
        gdrive_secure_storage: 'gdrive.err.secure_storage',
        gdrive_file_too_large: 'gdrive.err.file_too_large',
        gdrive_invalid_name: 'gdrive.err.invalid_name',
        gdrive_file_exists: 'gdrive.err.file_exists',
        file_invalid: 'file.err.invalid',
        file_newer: 'file.err.newer',
        file_too_large: 'file.err.too_large',
    };
    const code = String(e);
    return keys[code] ? t(keys[code]) : t('gdrive.err.generic', { error: code });
}

// Picker for the backups in the app's folder. Calls onPick with the chosen file.
function openBackupPicker(files, onPick) {
    const rows = files.map((f, i) => `
        <button data-i="${i}" class="w-full text-left px-3 py-2 rounded-lg border hover:bg-gray-50">
            <div class="text-sm text-gray-800 truncate">${escapeHtml(f.name)}</div>
            <div class="text-xs text-gray-400">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : ''}</div>
        </button>`).join('');
    const m = openModal(`
        <h4 class="font-semibold text-gray-700 mb-3">${t('gdrive.importTitle')}</h4>
        <div class="space-y-2">${rows}</div>
        <div class="flex justify-end mt-4">
            <button data-cancel class="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">${t('shotmap.edit.cancel')}</button>
        </div>`);
    m.el.addEventListener('click', ev => {
        if (ev.target === m.el || ev.target.closest('[data-cancel]')) { m.close(); return; }
        const row = ev.target.closest('[data-i]');
        if (!row) return;
        const file = files[Number(row.dataset.i)];
        m.close();
        onPick(file);
    });
}

function wireGDriveSection(modal) {
    const el = id => modal.querySelector('#' + id);
    const statusEl = el('gdrive-status');
    const connectBtn = el('gdrive-connect-btn');
    const exportBtn = el('gdrive-export-btn');
    const importBtn = el('gdrive-import-btn');
    const resultEl = el('gdrive-result');
    if (!connectBtn) return;

    // Result stays in the dialog until the next action (toasts disappear quickly and sit under the dialog).
    const showResult = (msg, isError = false) => {
        resultEl.textContent = msg;
        resultEl.className = `text-xs break-all ${isError ? 'text-red-600' : 'text-green-700'}`;
    };

    let connected = connectBtn.dataset.connected === '1';
    const render = (busy = false) => {
        connectBtn.textContent = connected ? t('gdrive.disconnect') : t('gdrive.connect');
        statusEl.textContent = connected ? t('gdrive.status.connected') : t('gdrive.status.disconnected');
        connectBtn.disabled = busy;
        exportBtn.disabled = busy || !connected;
        importBtn.disabled = busy || !connected;
    };
    // An auth failure means the stored sign-in is gone; reflect that in the UI.
    const handleError = (e) => {
        if (String(e) === 'gdrive_auth_revoked' || String(e) === 'gdrive_not_connected') connected = false;
        showResult(gdriveErrorText(e), true);
        toast(gdriveErrorText(e), true);
    };
    render();

    connectBtn.addEventListener('click', async () => {
        if (connected) {
            render(true);
            try {
                await gdriveDisconnect();
                connected = false;
                toast(t('gdrive.disconnected'));
            } catch (e) {
                handleError(e);
            }
            render();
            return;
        }
        try {
            const clientId = el('gdrive-client-id').value.trim();
            const clientSecret = el('gdrive-client-secret').value.trim();
            if (clientId) await gdriveSetConfig(clientId, clientSecret);
        } catch (e) {
            handleError(e);
            return;
        }
        render(true);
        statusEl.textContent = t('gdrive.waiting');
        try {
            await gdriveConnect();
            connected = true;
            toast(t('gdrive.status.connected'));
        } catch (e) {
            handleError(e);
        }
        render();
    });

    // Exports one bundle file, with the name the user typed, into the app's Drive folder.
    exportBtn.addEventListener('click', async () => {
        render(true);
        try {
            resultEl.classList.add('hidden');
            const r = await gdriveExport(el('gdrive-file-name').value);
            const msg = t('gdrive.exportSaved', { name: r.name, count: r.count });
            showResult(msg);
            toast(msg);
        } catch (e) {
            handleError(e);
        } finally {
            render();
        }
    });

    // Lists the backups in the app's folder, then imports the one the user picks.
    importBtn.addEventListener('click', async () => {
        render(true);
        let files = [];
        try {
            files = await gdriveListBackups();
        } catch (e) {
            handleError(e);
        } finally {
            render();
        }
        if (!files.length) {
            showResult(t('gdrive.noBackups'), true);
            toast(t('gdrive.noBackups'));
            return;
        }
        openBackupPicker(files, async file => {
            const choice = await askChoice(t('gdrive.confirm.import'), [
                { key: 'cancel', label: t('shotmap.edit.cancel') },
                { key: 'keep', label: t('file.import.keep') },
                { key: 'overwrite', label: t('file.import.overwrite'), primary: true },
            ]);
            if (choice !== 'keep' && choice !== 'overwrite') return;
            render(true);
            try {
                const r = await gdriveImport(file.id, choice === 'overwrite');
                const msg = t('file.import.done', { imported: r.imported, skipped: r.skipped_existing + r.skipped_invalid });
                showResult(msg);
                toast(msg);
                state.rounds = await getAllRounds();
                renderRoundsList();
                updateStats();
            } catch (e) {
                handleError(e);
            } finally {
                render();
            }
        });
    });
}

async function handleAppleSync() {
    if (state.syncing) return;

    // On Windows, MultipeerConnectivity isn't available — use WiFi sync instead
    if (state.platform === 'windows') {
        await handleMobileWifiSync('apple');
        return;
    }

    state.syncing = true;

    const btn   = document.getElementById('apple-sync-btn');
    const label = document.getElementById('apple-sync-label');
    btn.disabled = true;
    label.textContent = t('sync.apple.searching');

    // Listen for sync status events
    const unlisten = await listen('sync-status', (event) => {
        const { stage, detail } = event.payload;
        switch (stage) {
            case 'SEARCHING':
                label.textContent = t('sync.apple.searching');
                break;
            case 'FOUND':
                label.textContent = t('sync.apple.found');
                break;
            case 'CONNECTING':
                label.textContent = t('sync.apple.connecting');
                break;
            case 'CONNECTED':
                label.textContent = t('sync.apple.connected');
                break;
            case 'DOWNLOADING':
                if (detail) {
                    const [current, total] = detail.split('/');
                    label.textContent = t('sync.apple.downloading', { current, total });
                } else {
                    label.textContent = t('sync.syncing');
                }
                break;
            case 'RETRYING':
                if (detail) {
                    label.textContent = t('sync.apple.retrying', { attempt: detail });
                }
                break;
            case 'COMPLETED':
                if (detail && detail.includes(':')) {
                    const [synced, failed] = detail.split(':');
                    if (parseInt(failed) > 0) {
                        label.textContent = t('sync.apple.partial', { synced, failed });
                    } else {
                        label.textContent = t('sync.apple.completed');
                    }
                } else {
                    label.textContent = t('sync.apple.completed');
                }
                break;
        }
    });

    try {
        const newSummaries = await syncAppleRounds();
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));

        renderRoundsList();
        if (newSummaries.length > 0) loadDetail(newSummaries[0].id);
        toast(t('toast.synced', { count: newSummaries.length }));
        updateStats();
    } catch (e) {
        const msg = String(e).includes('not found') ? t('sync.apple.notfound') : t('toast.syncfail', { err: e });
        toast(msg, true);
    } finally {
        unlisten();
        state.syncing = false;
        btn.disabled = false;
        label.textContent = t('sync.label');
    }
}

async function handleAndroidSync() {
    if (state.syncing) return;
    await handleMobileWifiSync('android');
}

async function handleMobileWifiSync(source, manualHost) {
    if (state.syncing) return;
    state.syncing = true;

    const btnId = source === 'apple' ? 'apple-sync-btn' : 'android-sync-btn';
    const labelId = source === 'apple' ? 'apple-sync-label' : 'android-sync-label';
    const btn   = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    if (btn) btn.disabled = true;
    if (label) label.textContent = t('sync.syncing');

    try {
        const newSummaries = await syncMobileWifi(manualHost ?? null);
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));

        renderRoundsList();
        if (newSummaries.length > 0) loadDetail(newSummaries[0].id);
        toast(t('toast.synced', { count: newSummaries.length }));
        updateStats();
    } catch (e) {
        const errStr = String(e);
        const isNotFound = errStr.includes('not found') || errStr.includes('timeout') || errStr.includes('mDNS');
        if (isNotFound) {
            // Offer manual IP fallback
            showManualIpDialog(source);
        } else {
            toast(t('toast.syncfail', { err: e }), true);
        }
    } finally {
        state.syncing = false;
        if (btn) btn.disabled = false;
        if (label) label.textContent = source === 'apple' ? t('sync.label') : t('sync.android.label');
    }
}

function showManualIpDialog(source) {
    const modal = document.getElementById('setup-modal');
    const appName = source === 'apple' ? 'GoBirdie (iPhone)' : 'GoBirdie (Android)';
    modal.innerHTML = `
    <div class="modal-card" style="max-width:380px">
        <div class="text-center mb-4">
            <div class="text-3xl mb-2">${source === 'apple' ? '📱' : '🤖'}</div>
            <h2 class="text-lg font-bold text-gray-800">Phone Not Found</h2>
            <p class="text-sm text-gray-500 mt-2">
                Could not auto-discover ${appName} on the network.<br>
                Make sure <b>Sync Server</b> is enabled in the app Settings,
                then enter the phone's IP manually.
            </p>
        </div>
        <div class="space-y-3">
            <input id="manual-ip-input" type="text" placeholder="e.g. 192.168.1.42:7743"
                class="w-full p-2.5 border rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500">
            <div class="flex gap-3">
                <button id="manual-ip-cancel" class="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button id="manual-ip-connect" class="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">Connect</button>
            </div>
        </div>
    </div>`;
    modal.classList.remove('hidden');
    modal.querySelector('#manual-ip-cancel').addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('#manual-ip-connect').addEventListener('click', async () => {
        const host = modal.querySelector('#manual-ip-input').value.trim();
        if (!host) return;
        modal.classList.add('hidden');
        await handleMobileWifiSync(source, host);
    });
}

async function handleSync() {
    if (state.syncing) return;
    state.syncing = true;
    state.syncOffset = 0;

    const btn   = document.getElementById('sync-btn');
    const label = document.getElementById('sync-label');
    btn.disabled = true;
    label.textContent = t('sync.syncing');

    try {
        const newSummaries = await syncRounds(PAGE_SIZE, 0);
        // Merge into state.rounds (deduplicate by id)
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));
        state.syncOffset = PAGE_SIZE;

        renderRoundsList();
        if (newSummaries.length > 0) loadDetail(newSummaries[0].id);
        toast(t('toast.synced', {count: newSummaries.length}));
        updateStats();
    } catch (e) {
        toast(t('toast.syncfail', {err: e}), true);
    } finally {
        state.syncing = false;
        btn.disabled = false;
        label.textContent = t('sync.label');
    }
}

async function handleLoadMore() {
    if (state.syncing) return;
    state.syncing = true;

    const btn = document.getElementById('load-more-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

    try {
        const newSummaries = await syncRounds(PAGE_SIZE, state.syncOffset);
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));
        state.syncOffset += PAGE_SIZE;

        renderRoundsList();
        toast(t('toast.loaded', {count: newSummaries.length}));
        updateStats();
    } catch (e) {
        toast(t('toast.loadfail', {err: e}), true);
    } finally {
        state.syncing = false;
    }
}

async function updateStats() {
    try {
        const stats = await getStoreStats();
        document.getElementById('store-stats').textContent =
            t('rounds.stored', {count: stats.round_count, s: stats.round_count !== 1 ? 's' : ''});
    } catch (_) {}
}

// ── Init ─────────────────────────────────────────────────────────────────────

// ── Native menu actions (menu bar on macOS, in-window menu elsewhere) ───────

function initMenuActions() {
    listen('settings-changed', ev => applySettingsChange(ev.payload));
    listen('menu-action', async ev => {
        switch (ev.payload) {
            case 'settings': await openSettingsWindow(); break;
            case 'trends': await openTrendsWindow(); break;
            case 'file-export': await exportToFile(); break;
            case 'file-import': await importFromFile(); break;
            case 'gdrive': await renderDriveModal(); break;
        }
    });
}

// ── Trends View ──────────────────────────────────────────────────────────────

// ── Trends: filters (date range, courses, 9/18 holes, last N) and handicap ────

const TRENDS_FILTER_KEY = 'gobirdie.trendsFilters';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Local calendar date as YYYY-MM-DD (not toISOString, which is UTC).
function todayLocalStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Restores filters from sessionStorage; falls back to in-memory defaults if storage is unavailable.
function loadFilters() {
    const base = defaultFilters();
    try {
        const raw = sessionStorage.getItem(TRENDS_FILTER_KEY);
        if (raw) Object.assign(base, JSON.parse(raw));
    } catch (e) { /* storage unavailable or corrupt: use defaults */ }
    // Drop courses that no longer exist in the data; if none remain, the filter is cleared.
    const known = new Set(state.rounds.map(r => courseKey(r)));
    base.lastN = null;   // no last-N control any more
    base.courses = (Array.isArray(base.courses) ? base.courses : []).filter(k => known.has(k));
    return base;
}

function saveFilters() {
    try {
        sessionStorage.setItem(TRENDS_FILTER_KEY, JSON.stringify(state._trendsFilters));
    } catch (e) { /* keep in memory only */ }
}

// Single source for what the Trends page shows.
function getTrendsData() {
    const filters = state._trendsFilters;
    const today = todayLocalStr();
    const filtered = filterRounds(state.rounds, filters, today);
    const ids = new Set(filtered.map(r => r.id));
    const light = (state._trendLightRounds || []).filter(r => ids.has(r.id));
    // The handicap ignores last-N: its own "most recent 20" rule replaces it.
    const handicapSet = filterRounds(state.rounds, { ...filters, lastN: null }, today);
    return { filtered, light, handicapSet };
}

function subtitleText(count) {
    const total = state.rounds.filter(r => r.total_score > 0).length;
    return isFilterActive(state._trendsFilters)
        ? t('trends.subtitle.filtered', { count, total })
        : t('trends.subtitle', { count });
}

async function showTrendsView() {
    state.activeView = 'trends';
    state.activeId = null;
    if (!state._trendsFilters) state._trendsFilters = loadFilters();
    renderRoundsList();

    const content = document.getElementById('detail-content');
    const empty = document.getElementById('detail-empty');
    content.classList.remove('hidden');
    empty.classList.add('hidden');

    if (!state.rounds.some(r => r.total_score > 0)) {
        content.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-gray-400 py-20">
            <span class="text-5xl mb-4">📊</span>
            <p class="text-lg">${t('trends.nodata')}</p>
        </div>`;
        return;
    }

    const { filtered } = getTrendsData();
    content.innerHTML = buildTrendsPage();
    if (filtered.length) renderTrendsCharts(filtered);
    wireTrendsFilter();
    syncFilterBar();

    // Light rounds (SG and club trends) load asynchronously.
    try {
        state._trendLightRounds = await getAllRoundsLight();
        if (state.activeView !== 'trends') return;
        renderTrendsDetailSections();
    } catch (e) {
        console.error('Failed to load light rounds for trends:', e);
    }
}

function buildTrendsFilterBar() {
    const pill = (active, attrs, label) => `<button ${attrs} class="px-3 py-1 text-xs rounded-full border transition ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-blue-50'}">${label}</button>`;
    const f = state._trendsFilters;
    return `
    <div id="trends-filter-bar" class="bg-white rounded-xl shadow-sm border p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400">${t('trends.filter.date')}</span>
                <select id="trends-date-preset" class="px-2 py-1 text-xs border rounded-lg bg-white">
                    <option value="all">${t('trends.filter.preset.all')}</option>
                    <option value="season">${t('trends.filter.preset.season')}</option>
                    <option value="12m">${t('trends.filter.preset.12m')}</option>
                    <option value="custom">${t('trends.filter.preset.custom')}</option>
                </select>
                <div id="trends-date-custom" class="hidden">
                    <div class="flex items-center gap-1 text-xs text-gray-500">
                        <input id="trends-date-from" type="date" class="px-2 py-1 border rounded-lg text-xs" aria-label="${t('trends.filter.from')}">
                        <span>–</span>
                        <input id="trends-date-to" type="date" class="px-2 py-1 border rounded-lg text-xs" aria-label="${t('trends.filter.to')}">
                    </div>
                </div>
            </div>
            <div class="relative">
                <button id="trends-course-btn" class="px-3 py-1 text-xs rounded-full border border-gray-300 hover:bg-blue-50 transition"></button>
                <div id="trends-course-menu" class="hidden absolute z-20 mt-1 w-64 max-h-64 overflow-y-auto bg-white border rounded-lg shadow-lg p-2"></div>
            </div>
            <div class="flex gap-1" data-group="holes">
                ${pill(f.holes === 'all', 'data-holes="all"', t('shotmap.all'))}
                ${pill(f.holes === 9, 'data-holes="9"', t('trends.filter.holes9'))}
                ${pill(f.holes === 18, 'data-holes="18"', t('trends.filter.holes18'))}
            </div>
            <button id="trends-clear" class="ml-auto px-3 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">${t('trends.filter.clear')}</button>
        </div>
        <div id="trends-chips" class="hidden flex flex-wrap items-center gap-2"></div>
    </div>`;
}

function buildTrendsPage() {
    const { filtered } = getTrendsData();
    return `
    <div class="pt-6 pb-6 space-y-4">
        <div class="flex items-center justify-between">
            <h2 class="text-2xl font-bold text-gray-800">📊 ${t('trends.title')}</h2>
            <span id="trends-subtitle" class="text-sm text-gray-400">${subtitleText(filtered.length)}</span>
        </div>
        ${buildTrendsFilterBar()}
        <div id="trends-body" class="space-y-6">
            ${buildTrendsBody()}
        </div>
    </div>`;
}

// Body = handicap card, then the trend sections for the filtered rounds (or an empty state).
function buildTrendsBody() {
    const { filtered, handicapSet } = getTrendsData();
    const handicap = buildHandicapCard(handicapSet);
    if (!filtered.length) {
        return `${handicap}
        <div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">
            <p class="mb-3">${t('trends.nomatch')}</p>
            <button data-clear-filters class="px-3 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50">${t('trends.filter.clear')}</button>
        </div>`;
    }
    return `
        ${handicap}
        ${buildScoringTrends(filtered)}
        ${buildShortGameTrends(filtered)}
        <div id="trends-sg-section"><div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('detail.loading')}</div></div>
        <div id="trends-club-section"><div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('detail.loading')}</div></div>
        ${buildFitnessTrends(filtered)}`;
}

function wireTrendsFilter() {
    const bar = document.getElementById('trends-filter-bar');
    if (!bar) return;
    bar.addEventListener('click', onTrendsFilterClick);
    bar.addEventListener('change', onTrendsFilterChange);
    document.getElementById('trends-body')?.addEventListener('click', e => {
        if (e.target.closest('[data-clear-filters]')) {
            state._trendsFilters = defaultFilters();
            commitTrendsFilters();
        }
    });

    // Close the course menu on any outside click (one listener, replaced on each render).
    if (state._courseOutsideHandler) document.removeEventListener('click', state._courseOutsideHandler);
    state._courseOutsideHandler = e => {
        if (!state._courseMenuOpen) return;
        if (e.target.closest('#trends-course-menu') || e.target.closest('#trends-course-btn')) return;
        state._courseMenuOpen = false;
        document.getElementById('trends-course-menu')?.classList.add('hidden');
    };
    document.addEventListener('click', state._courseOutsideHandler);
}

function commitTrendsFilters() {
    saveFilters();
    rebuildTrends();
}

function onTrendsFilterClick(e) {
    const f = state._trendsFilters;
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'trends-course-btn') {
        state._courseMenuOpen = !state._courseMenuOpen;
        syncFilterBar();
    } else if (btn.id === 'trends-clear') {
        state._trendsFilters = defaultFilters();
        commitTrendsFilters();
    } else if (btn.dataset.holes) {
        f.holes = btn.dataset.holes === 'all' ? 'all' : Number(btn.dataset.holes);
        commitTrendsFilters();
    } else if ('courseAll' in btn.dataset) {
        f.courses = [];
        commitTrendsFilters();
    } else if (btn.dataset.chip) {
        removeTrendsChip(btn.dataset.chip);
    }
}

function onTrendsFilterChange(e) {
    const f = state._trendsFilters;
    const target = e.target;
    if (target.id === 'trends-date-preset') {
        f.preset = target.value;
        if (f.preset !== 'custom') { f.dateFrom = null; f.dateTo = null; }
        commitTrendsFilters();
    } else if (target.id === 'trends-date-from' || target.id === 'trends-date-to') {
        let from = document.getElementById('trends-date-from').value || null;
        let to = document.getElementById('trends-date-to').value || null;
        if (from && to && from > to) [from, to] = [to, from];   // swap instead of rejecting
        f.preset = 'custom';
        f.dateFrom = from;
        f.dateTo = to;
        commitTrendsFilters();
    } else if (target.dataset.course !== undefined) {
        const key = target.dataset.course;
        f.courses = target.checked
            ? [...new Set([...f.courses, key])]
            : f.courses.filter(k => k !== key);
        commitTrendsFilters();
    }
}

function removeTrendsChip(chip) {
    const f = state._trendsFilters;
    if (chip === 'date') { f.preset = 'all'; f.dateFrom = null; f.dateTo = null; }
    else if (chip === 'holes') f.holes = 'all';
    else if (chip.startsWith('course:')) {
        const key = chip.slice('course:'.length);
        f.courses = f.courses.filter(k => k !== key);
    }
    commitTrendsFilters();
}

// Updates the filter bar in place (no re-render), so date inputs keep focus.
function syncFilterBar() {
    const bar = document.getElementById('trends-filter-bar');
    if (!bar) return;
    const f = state._trendsFilters;
    const today = todayLocalStr();
    const range = effectiveDateRange(f, today);

    const setPill = (btn, active) => {
        btn.classList.toggle('bg-blue-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('border-blue-600', active);
        btn.classList.toggle('border-gray-300', !active);
    };
    document.getElementById('trends-date-preset').value = f.preset;
    document.getElementById('trends-date-custom').classList.toggle('hidden', f.preset !== 'custom');
    bar.querySelectorAll('[data-group="holes"] button').forEach(b =>
        setPill(b, String(f.holes) === b.dataset.holes));

    document.getElementById('trends-date-from').value = f.preset === 'custom' ? (f.dateFrom ?? '') : '';
    document.getElementById('trends-date-to').value = f.preset === 'custom' ? (f.dateTo ?? '') : '';

    const courseBtn = document.getElementById('trends-course-btn');
    courseBtn.textContent = f.courses.length
        ? t('trends.filter.courses.n', { n: f.courses.length })
        : t('trends.filter.courses');
    renderCourseMenu();
    document.getElementById('trends-course-menu').classList.toggle('hidden', !state._courseMenuOpen);

    document.getElementById('trends-clear').disabled = !isFilterActive(f);
    renderTrendsChips();
}

function renderCourseMenu() {
    const menu = document.getElementById('trends-course-menu');
    if (!menu) return;
    const f = state._trendsFilters;
    const courses = listCourses(state.rounds, f, todayLocalStr());
    const all = `<button data-course-all class="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-50 ${f.courses.length ? 'text-blue-600' : 'text-gray-500'}">${t('trends.filter.courses.all')}</button>`;
    const rows = courses.map(c => `
        <label class="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 rounded hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" data-course="${escapeHtml(c.key)}" ${f.courses.includes(c.key) ? 'checked' : ''}>
            <span class="truncate">${escapeHtml(c.name)} (${c.count})</span>
        </label>`).join('');
    menu.innerHTML = all + rows;
}

function renderTrendsChips() {
    const box = document.getElementById('trends-chips');
    if (!box) return;
    const f = state._trendsFilters;
    const range = effectiveDateRange(f, todayLocalStr());
    const chips = [];
    if (f.preset !== 'all') chips.push({ key: 'date', label: `${range.from ?? '…'} – ${range.to ?? '…'}` });
    f.courses.forEach(key => {
        const round = state.rounds.find(r => courseKey(r) === key);
        chips.push({ key: `course:${key}`, label: round?.course_name || '—' });
    });
    if (f.holes !== 'all') chips.push({ key: 'holes', label: t(f.holes === 9 ? 'trends.filter.holes9' : 'trends.filter.holes18') });

    box.classList.toggle('hidden', chips.length === 0);
    box.innerHTML = chips.length ? `
        <span class="text-xs text-gray-400">${t('trends.filter.active')}:</span>
        ${chips.map(c => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">
            ${escapeHtml(c.label)}
            <button data-chip="${escapeHtml(c.key)}" aria-label="${t('trends.filter.remove')}" class="hover:text-blue-900 leading-none">×</button>
        </span>`).join('')}` : '';
}

function rebuildTrends() {
    const container = document.getElementById('trends-body');
    if (!container) return;
    const { filtered } = getTrendsData();
    container.innerHTML = buildTrendsBody();
    if (filtered.length) renderTrendsCharts(filtered);
    if (state._trendLightRounds) renderTrendsDetailSections();
    const subtitle = document.getElementById('trends-subtitle');
    if (subtitle) subtitle.textContent = subtitleText(filtered.length);
    syncFilterBar();
}

function renderTrendsCharts(summaryRounds) {
    requestAnimationFrame(() => {
        renderScoreTrendChart(summaryRounds);
        renderShortGameTrendChart(summaryRounds);
        renderFitnessTrendChart(summaryRounds);
    });
}

function renderTrendsDetailSections() {
    const sgSection = document.getElementById('trends-sg-section');
    const clubSection = document.getElementById('trends-club-section');
    if (!sgSection || !clubSection) return;
    const { light } = getTrendsData();
    if (!light.length) {
        sgSection.innerHTML = `<div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('trends.nomatch')}</div>`;
        clubSection.innerHTML = '';
        return;
    }
    sgSection.innerHTML = buildSgTrends(light);
    requestAnimationFrame(() => renderSgTrendChart(light));
    clubSection.innerHTML = buildClubTrends(light);
    wireClubTrendControls(light);
}

// ── Handicap estimate card (no canvas; re-rendered with the body) ───────────

function buildHandicapCard(handicapSet) {
    const holes = state._trendsFilters.holes;
    const { h18, h9 } = computeHandicaps(handicapSet);
    const cells = [];
    if (holes === 'all' || holes === 18) cells.push({ h: h18, label: 't18' });
    if (holes === 'all' || holes === 9) cells.push({ h: h9, label: 't9' });
    // With "All", hide a bucket that has no rounds at all; a specific filter always shows its card.
    const visible = cells.filter(c => holes !== 'all' || c.h.eligible + c.h.excluded > 0);
    if (!visible.length) return '';

    const cell = ({ h, label }) => {
        const titleKey = label === 't18' ? 'trends.handicap.index18' : 'trends.handicap.index9';
        const index = h.status === 'ok' ? h.index.toFixed(1) : '—';
        let note = '';
        if (h.status === 'insufficient') note = t('trends.handicap.notenough', { needed: h.needed, have: h.eligible });
        if (h.status === 'norated') note = t('trends.handicap.norated');
        const excluded = h.excluded > 0 && h.status !== 'norated'
            ? `<p class="text-xs text-gray-400">${t('trends.handicap.excluded', { n: h.excluded })}</p>` : '';
        const used = h.status === 'ok' ? `
            <details class="mt-3">
                <summary class="text-xs text-blue-600 cursor-pointer">${t('trends.handicap.used', { best: h.best, recent: h.recent })}</summary>
                <table class="w-full text-xs mt-2">
                    <thead><tr class="text-gray-400">
                        <th class="text-left font-normal py-1">${t('trends.filter.date')}</th>
                        <th class="text-left font-normal py-1">${t('trends.filter.courses')}</th>
                        <th class="text-right font-normal py-1">${t('trends.handicap.diff')}</th>
                        <th class="text-right font-normal py-1">${t('trends.handicap.counted')}</th>
                    </tr></thead>
                    <tbody>${h.used.map(u => `
                        <tr class="${u.counted ? 'font-semibold text-gray-800' : 'text-gray-400'}">
                            <td class="py-0.5">${escapeHtml(u.date)}</td>
                            <td class="py-0.5 truncate max-w-[10rem]">${escapeHtml(u.course_name || '—')}</td>
                            <td class="py-0.5 text-right">${u.diff.toFixed(1)}</td>
                            <td class="py-0.5 text-right">${u.counted ? '✓' : ''}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </details>` : '';
        const nineNote = label === 't9' ? `<p class="text-xs text-gray-400 mt-2">${t('trends.handicap.nine')}</p>` : '';
        return `
        <div class="flex-1 min-w-[16rem] bg-gray-50 rounded-lg p-4">
            <div class="text-xs text-gray-500">${t(titleKey)}</div>
            <div class="text-3xl font-bold text-gray-800 mt-1">${index}</div>
            ${note ? `<p class="text-xs text-gray-500 mt-2">${note}</p>` : ''}
            ${excluded}
            ${used}
            ${nineNote}
        </div>`;
    };

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('trends.handicap.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('trends.handicap.estimate')} ${t('trends.handicap.note')}</p>
        <div class="flex flex-wrap gap-4">${visible.map(cell).join('')}</div>
    </div>`;
}


function buildScoringTrends(rounds) {
    const scores = rounds.map(r => r.total_score);
    const overPars = rounds.map(r => r.score_over_par);
    const best = Math.min(...scores);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    const avgOverPar = Math.round(overPars.reduce((a, b) => a + b, 0) / overPars.length * 10) / 10;
    const recent5 = scores.slice(-5);
    const earlier5 = scores.slice(-10, -5);
    let trendArrow = '→';
    if (recent5.length >= 3 && earlier5.length >= 3) {
        const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
        const earlierAvg = earlier5.reduce((a, b) => a + b, 0) / earlier5.length;
        if (recentAvg < earlierAvg - 1) trendArrow = '↓';
        else if (recentAvg > earlierAvg + 1) trendArrow = '↑';
    }
    const trendColor = trendArrow === '↓' ? 'text-green-600' : trendArrow === '↑' ? 'text-red-600' : 'text-gray-500';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('trends.scoring')}</h3>
        <div class="grid grid-cols-4 gap-4 mb-4 text-center">
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-700">${best}</div>
                <div class="text-xs text-gray-500">${t('trends.best')}</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-700">${avg}</div>
                <div class="text-xs text-gray-500">${t('trends.avgscore')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold ${avgOverPar > 0 ? 'text-red-600' : 'text-green-600'}">${avgOverPar > 0 ? '+' : ''}${avgOverPar}</div>
                <div class="text-xs text-gray-500">${t('trends.avgoverpar')}</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold ${trendColor}">${trendArrow}</div>
                <div class="text-xs text-gray-500">${t('trends.trend')}</div>
            </div>
        </div>
        <div style="height:220px"><canvas id="score-trend-chart"></canvas></div>
    </div>`;
}

function renderScoreTrendChart(rounds) {
    const canvas = document.getElementById('score-trend-chart');
    if (!canvas) return;
    const labels = rounds.map(r => r.date.slice(5));
    const overPars = rounds.map(r => r.score_over_par);
    // 5-round moving average
    const ma = overPars.map((_, i) => {
        const start = Math.max(0, i - 4);
        const slice = overPars.slice(start, i + 1);
        return +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1);
    });

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: t('trends.overpar'),
                    data: overPars,
                    borderColor: 'rgb(239,68,68)',
                    backgroundColor: overPars.map(v => v <= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'),
                    borderWidth: 1.5,
                    pointRadius: 4,
                    pointStyle: 'circle',
                    tension: 0.3,
                },
                {
                    label: t('trends.movingavg'),
                    data: ma,
                    borderColor: 'rgb(99,102,241)',
                    borderWidth: 2,
                    borderDash: [6, 3],
                    pointRadius: 0,
                    tension: 0.4,
                },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}` } },
            },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { title: { display: true, text: t('trends.overpar'), font: { size: 11 } }, ticks: { font: { size: 10 }, callback: v => v > 0 ? `+${v}` : v } },
            }
        }
    });
}

function buildShortGameTrends(rounds) {
    const totalPutts = rounds.reduce((a, r) => a + r.total_putts, 0);
    const totalHoles = rounds.reduce((a, r) => a + r.holes_played, 0);
    const avgPuttsPerHole = totalHoles > 0 ? (totalPutts / totalHoles).toFixed(1) : '—';
    const avgGir = totalHoles > 0 ? Math.round(rounds.reduce((a, r) => a + r.gir, 0) / rounds.length * 10) / 10 : '—';
    const avgFir = rounds.length > 0 ? Math.round(rounds.reduce((a, r) => a + r.fairways_hit, 0) / rounds.length * 10) / 10 : '—';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('trends.shortgame')}</h3>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-700">${avgPuttsPerHole}</div>
                <div class="text-xs text-gray-500">${t('trends.puttsperhole')}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-700">${avgGir}</div>
                <div class="text-xs text-gray-500">${t('trends.avggir')}</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-3">
                <div class="text-xl font-bold text-yellow-700">${avgFir}</div>
                <div class="text-xs text-gray-500">${t('trends.avgfir')}</div>
            </div>
        </div>
        <div style="height:220px"><canvas id="shortgame-trend-chart"></canvas></div>
    </div>`;
}

function renderShortGameTrendChart(rounds) {
    const canvas = document.getElementById('shortgame-trend-chart');
    if (!canvas) return;
    const labels = rounds.map(r => r.date.slice(5));
    const putts = rounds.map(r => r.total_putts);
    const gir = rounds.map(r => r.gir);

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: t('trends.putts'),
                    data: putts,
                    borderColor: 'rgb(59,130,246)',
                    borderWidth: 1.5,
                    pointRadius: 3,
                    tension: 0.3,
                    yAxisID: 'yPutts',
                },
                {
                    label: 'GIR',
                    data: gir,
                    borderColor: 'rgb(34,197,94)',
                    borderWidth: 1.5,
                    pointRadius: 3,
                    tension: 0.3,
                    yAxisID: 'yGir',
                },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                yPutts: { type: 'linear', position: 'left', title: { display: true, text: t('trends.putts'), font: { size: 11 } }, ticks: { font: { size: 10 } } },
                yGir: { type: 'linear', position: 'right', title: { display: true, text: 'GIR', font: { size: 11 } }, ticks: { font: { size: 10 } }, grid: { drawOnChartArea: false } },
            }
        }
    });
}

function buildFitnessTrends(rounds) {
    const hrRounds = rounds.filter(r => r.avg_heart_rate);
    const avgHr = hrRounds.length ? Math.round(hrRounds.reduce((a, r) => a + r.avg_heart_rate, 0) / hrRounds.length) : '—';
    const calRounds = rounds.filter(r => r.calories);
    const avgCal = calRounds.length ? Math.round(calRounds.reduce((a, r) => a + r.calories, 0) / calRounds.length) : '—';
    const tempoRounds = rounds.filter(r => r.avg_swing_tempo);
    const avgTempo = tempoRounds.length ? (tempoRounds.reduce((a, r) => a + r.avg_swing_tempo, 0) / tempoRounds.length).toFixed(1) : '—';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('trends.fitness')}</h3>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-xl font-bold text-red-600">${avgHr}</div>
                <div class="text-xs text-gray-500">${t('trends.avghr')}</div>
            </div>
            <div class="bg-orange-50 rounded-lg p-3">
                <div class="text-xl font-bold text-orange-600">${avgCal}</div>
                <div class="text-xs text-gray-500">${t('trends.avgcal')}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${avgTempo !== '—' ? avgTempo + ':1' : '—'}</div>
                <div class="text-xs text-gray-500">${t('trends.avgtempo')}</div>
            </div>
        </div>
        <div style="height:220px"><canvas id="fitness-trend-chart"></canvas></div>
    </div>`;
}

function renderFitnessTrendChart(rounds) {
    const canvas = document.getElementById('fitness-trend-chart');
    if (!canvas) return;
    const labels = rounds.map(r => r.date.slice(5));
    const hr = rounds.map(r => r.avg_heart_rate ?? null);
    const cal = rounds.map(r => r.calories ?? null);
    const tempo = rounds.map(r => r.avg_swing_tempo ? +r.avg_swing_tempo.toFixed(2) : null);

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: t('trends.hr'),
                    data: hr,
                    borderColor: 'rgb(239,68,68)',
                    borderWidth: 1.5,
                    pointRadius: 3,
                    tension: 0.3,
                    yAxisID: 'yHr',
                    spanGaps: true,
                },
                {
                    label: t('trends.calories'),
                    data: cal,
                    borderColor: 'rgb(249,115,22)',
                    borderWidth: 1.5,
                    pointRadius: 3,
                    tension: 0.3,
                    yAxisID: 'yCal',
                    spanGaps: true,
                },
                {
                    label: t('trends.tempo'),
                    data: tempo,
                    borderColor: 'rgb(16,185,129)',
                    borderWidth: 0,
                    pointRadius: 4,
                    showLine: false,
                    yAxisID: 'yTempo',
                    spanGaps: false,
                },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                yHr: { type: 'linear', position: 'left', title: { display: true, text: t('trends.hr'), font: { size: 11 } }, ticks: { font: { size: 10 } } },
                yCal: { type: 'linear', position: 'right', title: { display: true, text: t('trends.calories'), font: { size: 11 } }, ticks: { font: { size: 10 } }, grid: { drawOnChartArea: false } },
                yTempo: { type: 'linear', position: 'right', display: false, min: 1.5, max: 6.0 },
            }
        }
    });
}

// ── SG Trends (uses light rounds with scorecards) ────────────────────────────

function computeSgForRound(round) {
    // Reuse existing computeStrokesGained which works on any round with scorecard
    return computeStrokesGained(round);
}

function buildSgTrends(lightRounds) {
    const sgData = lightRounds
        .map(r => ({ round: r, sg: computeSgForRound(r) }))
        .filter(d => d.sg != null);

    if (sgData.length < 2) {
        return `<div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('trends.sg.nodata')}</div>`;
    }

    const avgTotal = sgData.reduce((a, d) => a + d.sg.total, 0) / sgData.length;
    const cats = ['off_tee', 'approach', 'short_game', 'putting'];
    const catAvgs = {};
    cats.forEach(c => {
        catAvgs[c] = sgData.reduce((a, d) => a + d.sg.categories[c], 0) / sgData.length;
    });
    const strongest = cats.reduce((a, b) => catAvgs[a] > catAvgs[b] ? a : b);
    const weakest = cats.reduce((a, b) => catAvgs[a] < catAvgs[b] ? a : b);
    const catLabels = { off_tee: t('sg.offtee'), approach: t('sg.approach'), short_game: t('sg.shortgame'), putting: t('sg.putting') };

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${t('trends.sg.title')}</h3>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold" style="color:${sgColor(avgTotal)}">${avgTotal >= 0 ? '+' : ''}${avgTotal.toFixed(1)}</div>
                <div class="text-xs text-gray-500">${t('trends.sg.avgtotal')}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-lg font-bold text-green-700">${catLabels[strongest]}</div>
                <div class="text-xs text-gray-500">${t('trends.sg.strongest')}</div>
            </div>
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-lg font-bold text-red-700">${catLabels[weakest]}</div>
                <div class="text-xs text-gray-500">${t('trends.sg.weakest')}</div>
            </div>
        </div>
        <div style="height:240px"><canvas id="sg-trend-chart"></canvas></div>
    </div>`;
}

function renderSgTrendChart(lightRounds) {
    const canvas = document.getElementById('sg-trend-chart');
    if (!canvas) return;

    const sgData = lightRounds
        .map(r => ({ round: r, sg: computeSgForRound(r) }))
        .filter(d => d.sg != null);

    const labels = sgData.map(d => {
        const dt = new Date((d.round.start_ts + GARMIN_EPOCH) * 1000);
        return `${dt.getMonth()+1}/${dt.getDate()}`;
    });

    const colors = {
        off_tee: 'rgb(239,68,68)',
        approach: 'rgb(59,130,246)',
        short_game: 'rgb(234,179,8)',
        putting: 'rgb(16,185,129)',
    };
    const catLabels = { off_tee: t('sg.offtee'), approach: t('sg.approach'), short_game: t('sg.shortgame'), putting: t('sg.putting') };

    const datasets = Object.entries(colors).map(([cat, color]) => ({
        label: catLabels[cat],
        data: sgData.map(d => +d.sg.categories[cat].toFixed(2)),
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 3,
        tension: 0.3,
    }));

    new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y}` } },
            },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { title: { display: true, text: 'SG', font: { size: 11 } }, ticks: { font: { size: 10 }, callback: v => v >= 0 ? `+${v}` : v } },
            }
        }
    });
}

// ── Club Trends (uses light rounds with scorecards) ──────────────────────────

function filterOutliers(distances) {
    if (!state.settings?.exclude_outliers || distances.length < 4) {
        return { normal: distances, excluded: [] };
    }
    const sorted = [...distances].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    return {
        normal: distances.filter(d => d >= lower && d <= upper),
        excluded: distances.filter(d => d < lower || d > upper),
    };
}

// Collect per-shot data from light rounds, optionally limited to last N rounds
function collectClubShots(lightRounds, lastN) {
    const rounds = lastN ? lightRounds.slice(-lastN) : lightRounds;
    const clubMap = {};
    rounds.forEach(r => {
        const sc = r.scorecard;
        if (!sc?.hole_scores?.length) return;
        const dt = new Date((r.start_ts + GARMIN_EPOCH) * 1000);
        const dateLabel = `${dt.getMonth()+1}/${dt.getDate()}`;
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const green = shots[shots.length - 1].to;
            shots.forEach(shot => {
                const cat = shot.club_category ?? 'unknown';
                if (cat === 'putt') return;
                const name = shot.club_name ?? cat;
                const dist = metersToYards(distMeters(shot.from, shot.to));
                const shotBear = bearing(shot.from, shot.to);
                const greenBear = bearing(shot.from, green);
                const dev = deviation(shotBear, greenBear);
                if (!clubMap[name]) clubMap[name] = { cat, shots: [] };
                clubMap[name].shots.push({ distYds: dist, dev, dateLabel, roundTs: r.start_ts });
            });
        });
    });
    return clubMap;
}

function buildClubTrends(lightRounds) {
    const clubMap = collectClubShots(lightRounds);
    const clubs = Object.entries(clubMap)
        .filter(([, v]) => v.shots.length >= 3)
        .map(([name, v]) => {
            const dists = v.shots.map(s => s.distYds);
            const { normal, excluded } = filterOutliers(dists);
            const avg = normal.length ? Math.round(normal.reduce((a, b) => a + b, 0) / normal.length) : 0;
            const max = normal.length ? Math.round(Math.max(...normal)) : 0;
            const straight = v.shots.filter(s => Math.abs(s.dev) < 15).length;
            return { name, cat: v.cat, shots: v.shots.length, avg, max, excluded: excluded.length, straightPct: Math.round(straight / v.shots.length * 100) };
        })
        .sort((a, b) => clubSortKey(a.name) - clubSortKey(b.name));

    if (!clubs.length) {
        return `<div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('trends.club.nodata')}</div>`;
    }

    const maxAvg = Math.max(...clubs.map(c => c.avg));
    const rows = clubs.map(c => {
        const exclNote = c.excluded > 0 ? `<span class="text-xs text-gray-400 ml-1">(${c.excluded} ${t('trends.club.excl')})</span>` : '';
        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2 text-sm font-medium">${c.name}</td>
            <td class="py-2 text-xs text-gray-400 text-center">${c.shots}</td>
            <td class="py-2">
                <div class="flex items-center gap-2">
                    <div class="w-24 bg-gray-100 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full" style="width:${(c.avg/maxAvg*100).toFixed(0)}%"></div>
                    </div>
                    <span class="text-sm font-medium">${c.avg} yds</span>
                    ${exclNote}
                </div>
            </td>
            <td class="py-2 text-xs text-gray-400">${c.max} yds</td>
            <td class="py-2 text-xs ${c.straightPct >= 60 ? 'text-green-600' : 'text-gray-400'}">${c.straightPct}%</td>
        </tr>`;
    }).join('');

    // Club pills for detail section
    const clubNames = clubs.map(c => c.name);
    const clubPills = clubNames.map((n, i) => `
        <button class="club-detail-btn px-3 py-1 text-xs rounded-full border transition
            ${i === 0 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-blue-50 hover:border-blue-400'}" data-club="${n}">
            ${n}
        </button>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('trends.club.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('trends.club.desc')}</p>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">${t('stats.club')}</th>
                    <th class="text-center py-1">${t('scorecard.shots')}</th>
                    <th class="text-left py-1">${t('trends.club.avgdist')}</th>
                    <th class="text-left py-1">Max</th>
                    <th class="text-left py-1">${t('stats.straightpct')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border p-6 mt-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('trends.clubdetail.title')}</h3>
        <div class="flex items-center gap-3 mb-4 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">${clubPills}</div>
        </div>
        <div id="club-detail-charts">
            <div class="grid grid-cols-2 gap-4">
                <div style="height:220px"><canvas id="club-dist-chart"></canvas></div>
                <div style="height:220px"><canvas id="club-dir-chart"></canvas></div>
            </div>
        </div>
    </div>`;
}

let _clubDistChart = null;
let _clubDirChart = null;

function wireClubTrendControls(lightRounds) {
    let selectedClub = document.querySelector('.club-detail-btn')?.dataset.club;

    function refresh() {
        renderClubDetailCharts(lightRounds, selectedClub);
    }

    document.querySelectorAll('.club-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.club-detail-btn').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                b.classList.add('border-gray-300');
            });
            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            btn.classList.remove('border-gray-300');
            selectedClub = btn.dataset.club;
            refresh();
        });
    });

    if (selectedClub) refresh();
}

function renderClubDetailCharts(lightRounds, clubName) {
    const clubMap = collectClubShots(lightRounds);
    const data = clubMap[clubName];
    if (!data?.shots.length) return;

    // Group shots by round date
    const byRound = {};
    data.shots.forEach(s => {
        const key = s.dateLabel;
        if (!byRound[key]) byRound[key] = { dists: [], devs: [], ts: s.roundTs };
        byRound[key].dists.push(s.distYds);
        byRound[key].devs.push(s.dev);
    });

    const roundKeys = Object.keys(byRound).sort((a, b) => byRound[a].ts - byRound[b].ts);
    const labels = roundKeys;
    const avgDists = roundKeys.map(k => {
        const { normal } = filterOutliers(byRound[k].dists);
        return normal.length ? Math.round(normal.reduce((a, b) => a + b, 0) / normal.length) : null;
    });
    const avgDevs = roundKeys.map(k => {
        const devs = byRound[k].devs;
        return devs.length ? Math.round(devs.reduce((a, b) => a + b, 0) / devs.length) : null;
    });
    const straightPcts = roundKeys.map(k => {
        const devs = byRound[k].devs;
        return devs.length ? Math.round(devs.filter(d => Math.abs(d) < 15).length / devs.length * 100) : null;
    });

    // Distance chart
    if (_clubDistChart) _clubDistChart.destroy();
    const distCanvas = document.getElementById('club-dist-chart');
    if (distCanvas) {
        _clubDistChart = new Chart(distCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: `${clubName} ${t('trends.club.avgdist')}`,
                    data: avgDists,
                    borderColor: 'rgb(59,130,246)',
                    borderWidth: 2,
                    pointRadius: 4,
                    tension: 0.3,
                    spanGaps: true,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                    y: { title: { display: true, text: t('stats.dist') + ' (yds)', font: { size: 11 } }, ticks: { font: { size: 10 } } },
                }
            }
        });
    }

    // Direction chart
    if (_clubDirChart) _clubDirChart.destroy();
    const dirCanvas = document.getElementById('club-dir-chart');
    if (dirCanvas) {
        _clubDirChart = new Chart(dirCanvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: t('trends.clubdetail.avgdev'),
                        data: avgDevs,
                        backgroundColor: avgDevs.map(v => v == null ? 'transparent' : v > 10 ? 'rgba(249,115,22,0.6)' : v < -10 ? 'rgba(59,130,246,0.6)' : 'rgba(34,197,94,0.6)'),
                        borderRadius: 3,
                        yAxisID: 'yDev',
                    },
                    {
                        label: t('stats.straightpct'),
                        data: straightPcts,
                        type: 'line',
                        borderColor: 'rgb(34,197,94)',
                        borderWidth: 1.5,
                        pointRadius: 3,
                        tension: 0.3,
                        yAxisID: 'yPct',
                        spanGaps: true,
                    },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                    yDev: { type: 'linear', position: 'left', title: { display: true, text: t('trends.clubdetail.deviation'), font: { size: 11 } }, ticks: { font: { size: 10 }, callback: v => `${v > 0 ? '+' : ''}${v}°` } },
                    yPct: { type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: t('stats.straightpct'), font: { size: 11 } }, ticks: { font: { size: 10 }, callback: v => `${v}%` }, grid: { drawOnChartArea: false } },
                }
            }
        });
    }
}

function onLangChange() {
    applyStaticTranslations();
    renderRoundsList();
    if (state.activeView === 'trends') showTrendsView();
    else if (state.activeRound) renderDetailTabs();
    updateStats();
}

document.addEventListener('click', async e => {
    if (e.target.closest('#ask-ai-btn') && state.activeRound) {
        openCoachingModal(state.activeRound.id);
        return;
    }

    const btn = e.target.closest('[data-feedback]');
    if (!btn) return;
    const code    = btn.dataset.code;
    const helpful = btn.dataset.feedback === 'up';
    const roundId = state.activeRound?.id;
    if (!roundId || !code) return;

    const row = btn.closest('[data-insight-code]');
    row?.querySelectorAll('[data-feedback]').forEach(b => {
        b.classList.remove('text-green-500', 'text-red-400');
        b.classList.add('text-gray-300');
    });
    btn.classList.remove('text-gray-300');
    btn.classList.add(helpful ? 'text-green-500' : 'text-red-400');

    invoke('save_feedback', { roundId, code, helpful }).catch(console.error);
});

// Trends runs in its own window (?view=trends). It shares the web app but shows only the trends page.
const isTrendsWindow = new URLSearchParams(window.location.search).get('view') === 'trends';
const isSettingsWindow = new URLSearchParams(window.location.search).get('view') === 'settings';

async function openTrendsWindow() {
    const existing = await WebviewWindow.getByLabel('trends');
    if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
    }
    new WebviewWindow('trends', {
        url: 'index.html?view=trends',
        title: 'GoBirdie — Trends',
        width: 1100,
        height: 800,
        minWidth: 720,
        minHeight: 560,
    });
}

async function initTrendsWindow() {
    document.querySelector('header')?.classList.add('hidden');
    document.getElementById('rounds-sidebar')?.classList.add('hidden');
    state.settings = await getSettings().catch(() => null);
    state.rounds = await getAllRounds().catch(() => []);
    await showTrendsView();
}

// ── Settings window (own window, ?view=settings) ─────────────────────────────

async function openSettingsWindow() {
    const existing = await WebviewWindow.getByLabel('settings');
    if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
    }
    new WebviewWindow('settings', {
        url: 'index.html?view=settings',
        title: 'GoBirdie — Settings',
        width: 560,
        height: 720,
        minWidth: 420,
        minHeight: 520,
    });
}

async function initSettingsWindow() {
    document.body.classList.add('settings-window');
    document.querySelector('header')?.classList.add('hidden');
    document.getElementById('rounds-sidebar')?.classList.add('hidden');
    document.getElementById('detail-panel')?.classList.add('hidden');

    state.platform = await getPlatform().catch(() => 'unknown');
    state.isAppleSilicon = await getIsAppleSilicon().catch(() => false);
    state.settings = await getSettings().catch(() => null);
    await renderSetupModal(false);

    // Track unsaved edits so closing the window can ask first.
    const modal = document.getElementById('setup-modal');
    state._settingsDirty = false;
    const markDirty = () => { state._settingsDirty = true; };
    modal.addEventListener('input', markDirty);
    modal.addEventListener('change', markDirty);

    await getCurrentWebviewWindow().onCloseRequested(async event => {
        if (!state._settingsDirty) return;
        event.preventDefault();
        const choice = await askChoice(t('settings.unsaved'), [
            { key: 'cancel', label: t('shotmap.edit.cancel') },
            { key: 'discard', label: t('settings.discard') },
            { key: 'save', label: t('settings.save'), primary: true },
        ]);
        if (choice === 'save') modal.querySelector('#setup-save-btn')?.click();
        else if (choice === 'discard') {
            state._settingsDirty = false;
            await getCurrentWebviewWindow().destroy();
        }
    });
}

// Main window: apply settings saved in the Settings window without a restart.
function applySettingsChange({ settings, language }) {
    state.settings = settings;
    applySyncButtonVisibility();
    if (language && language !== getLang()) {
        setLang(language);
        onLangChange();
    }
}

async function init() {
    if (isTrendsWindow) {
        await initTrendsWindow();
        return;
    }
    if (isSettingsWindow) {
        await initSettingsWindow();
        return;
    }
    document.getElementById('sync-btn').addEventListener('click', handleSync);
    document.getElementById('apple-sync-btn')?.addEventListener('click', handleAppleSync);
    document.getElementById('android-sync-btn')?.addEventListener('click', handleAndroidSync);
    document.getElementById('search-input').addEventListener('input', e => {
        state.searchTerm = e.target.value.toLowerCase();
        renderRoundsList();
    });

    initMenuActions();
    applyStaticTranslations();

    // Check first-run: load settings
    try {
        state.platform = await getPlatform().catch(() => 'unknown');
        state.isAppleSilicon = await getIsAppleSilicon().catch(() => false);
        const settings = await getSettings();
        if (!settings || !settings.device_source) {
            // First run — show setup modal, don't load data yet
            await renderSetupModal(true);
            return;
        }
        state.settings = settings;
        applySyncButtonVisibility();
        await loadInitialData();
    } catch (e) {
        console.error('Init error:', e);
        // If settings fetch fails, show setup anyway
        await renderSetupModal(true);
    }
}

async function loadInitialData() {
    try {
        state.rounds = await getAllRounds();
        renderRoundsList();
        updateStats();
        if (state.rounds.length > 0) loadDetail(state.rounds[0].id);
    } catch (e) {
        console.error('Load error:', e);
    }
}

function applyStaticTranslations() {
    document.getElementById('app-title').textContent = t('app.title');
    document.getElementById('sync-label').textContent = state.syncing ? t('sync.syncing') : t('sync.label');
    document.getElementById('search-input').placeholder = t('search.placeholder');
}

export { state, buildAiPrompt, computeStrokesGained };

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


// ── Miss Bias Helper (appended for NLG context) ──────────────────────────────
// Compute percentage of shots missing right/left for extreme bias detection
function computeMissBiasPercentages(clubStats) {
    if (!clubStats || !clubStats.length) return {};
    
    const result = {};
    
    // Driver miss bias
    const driver = clubStats.find(c => /driver/i.test(c.name));
    if (driver) {
        // Estimate right/left shots based on avgDev and shots count
        // If avgDev > 0, bias is right; if < 0, bias is left
        // Use a simple heuristic: shots with |dev| > 15 are "missed" in that direction
        const rightShots = driver.avgDev > 0 ? Math.round(driver.shots * Math.min(1, driver.avgDev / 30)) : 0;
        const leftShots = driver.avgDev < 0 ? Math.round(driver.shots * Math.min(1, Math.abs(driver.avgDev) / 30)) : 0;
        result.driverRightPct = Math.round(rightShots / driver.shots * 100);
        result.driverLeftPct = Math.round(leftShots / driver.shots * 100);
    }
    
    // Iron miss bias
    const irons = clubStats.filter(c => /\\d-iron|iron/i.test(c.name));
    if (irons.length) {
        const totalShots = irons.reduce((a, c) => a + c.shots, 0);
        const rightShots = irons.reduce((a, c) => a + (c.avgDev > 0 ? Math.round(c.shots * Math.min(1, c.avgDev / 30)) : 0), 0);
        const leftShots = irons.reduce((a, c) => a + (c.avgDev < 0 ? Math.round(c.shots * Math.min(1, Math.abs(c.avgDev) / 30)) : 0), 0);
        result.ironRightPct = Math.round(rightShots / totalShots * 100);
        result.ironLeftPct = Math.round(leftShots / totalShots * 100);
    }
    
    return result;
}
