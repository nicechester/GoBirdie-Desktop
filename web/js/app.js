import { invoke } from '@tauri-apps/api/core';
import { buildInsightsCard, buildInsightsText, generateInsights } from './nlg-engine.js';
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

async function getPlatform() {
    return invoke('get_platform');
}

async function deleteRound(id) {
    return invoke('delete_round', { id });
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm z-50 ${
        isError ? 'bg-red-700' : 'bg-gray-800'} text-white`;
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
        const round = await getRoundDetail(id);
        if (!round) { content.innerHTML = '<p class="text-red-500">Round not found.</p>'; return; }
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
        btn.addEventListener('click', () => {
            if (state.activeTab === btn.dataset.tab) return;
            state.activeTab = btn.dataset.tab;
            renderDetailTabs();
        });
    });

    // Ask AI button
    document.getElementById('ask-ai-btn')?.addEventListener('click', async () => {
        const prompt = buildAiPrompt(round);
        await navigator.clipboard.writeText(prompt);
        toast(t('toast.copied'));
    });

    // Post-render hooks
    if (state.activeTab === 'overview') {
        // no chart in overview anymore
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

function buildScorecard(sc) {
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));
    // Sum par only for holes actually played
    const scoredPar = sc.hole_scores.reduce((sum, hs) => sum + (parMap[hs.hole_number]?.par ?? 0), 0);
    const rows = sc.hole_scores.map(hs => {
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
    }).join('');

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
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="font-bold bg-gray-50">
                        <td>${t('scorecard.total')}</td><td>${scoredPar}</td><td></td><td></td>
                        <td>${sc.total_score} (${overParStr(sc.total_score - scoredPar)})</td>
                        <td>${sc.total_putts}</td><td></td><td></td>
                    </tr>
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
async function fetchLieAngles(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return {};

    const OFFSET_M = 10;
    const queries = [];

    sc.hole_scores.forEach(hs => {
        hs.shots.forEach((shot, idx) => {
            if (shot.club_category === 'putt') return;
            const bear = bearing(shot.from, shot.to);
            const left  = offsetPoint(shot.from, bear - 90, OFFSET_M);
            const right = offsetPoint(shot.from, bear + 90, OFFSET_M);
            queries.push({ key: `${hs.hole_number}-${idx}`, left, right });
        });
    });

    if (!queries.length) return {};

    const allPoints = queries.flatMap(q => [q.left, q.right]);
    const locations = allPoints.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`);
    const results = {};

    try {
        const elevations = await invoke('fetch_elevations', { locations });

        queries.forEach((q, i) => {
            const leftElev = elevations[i * 2];
            const rightElev = elevations[i * 2 + 1];
            if (leftElev != null && rightElev != null) {
                const diff = rightElev - leftElev;
                const angle = Math.atan2(diff, OFFSET_M * 2) * 180 / Math.PI;
                let label;
                if (Math.abs(angle) < 1) label = 'Flat';
                else if (angle > 0) label = `+${angle.toFixed(1)}°`;
                else label = `${angle.toFixed(1)}°`;
                results[q.key] = { angle, label };
            }
        });
    } catch (e) {
        console.error('[fetchLieAngles] API call failed:', e.message, e);
    }

    return results;
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
        </div>

        <!-- Map and Timeline split layout -->
        <div class="flex gap-4 flex-1 min-h-0">
            <!-- Left: Map -->
            <div class="bg-white rounded-xl shadow-sm border p-4 flex flex-col flex-1">
                <div id="shot-map-wrapper" class="flex-1 mb-3">
                    <div id="shot-map"></div>
                </div>
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

    // All source/layer creation and interactions happen after map loads
    activeMap.on('load', () => {
        // Add zoom controls
        activeMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        console.log('Map loaded, building shot visualizations. allShots count:', allShots.length);
        activeMap.fitBounds(bounds, { padding: 70, duration: 0 });
        console.log('fitBounds completed, now building features');

        // Club abbreviation helper
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

    try {
        allShots.forEach((shot, idx) => {
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
        console.error('Error building shot features:', err.message, err.stack);
    }

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

    const catOrder = ['tee', 'fairway_wood', 'iron', 'wedge', 'unknown'];
    const clubs = Object.entries(byClub)
        .map(([name, shots]) => ({
            name,
            cat: shots[0].cat,
            count: shots.length,
            avg: shots.reduce((a, s) => a + s.distYds, 0) / shots.length,
            max: Math.max(...shots.map(s => s.distYds)),
            straight: shots.filter(s => Math.abs(s.deviation) < 15).length,
        }))
        .sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || b.avg - a.avg);

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
        .sort((a, b) => b.avgDist - a.avgDist);

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
                const elevGain = cachedElevGain[`${hs.hole_number}-${i}`];
                const lie = null;
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

function renderSetupModal(isFirstRun) {
    const modal = document.getElementById('setup-modal');
    const name = state.settings?.player_name ?? '';
    const device = state.settings?.device_source ?? '';
    const lang = getLang();
    const sgBaseline = state.settings?.sg_baseline ?? '10';
    const excludeOutliers = state.settings?.exclude_outliers ?? true;

    modal.innerHTML = `
    <div class="modal-card">
        <div class="text-center mb-6">
            <div class="text-4xl mb-2">⛳</div>
            <h2 class="text-xl font-bold">
                <span class="text-red-500">Go</span><span class="text-blue-600">Birdie</span>
                ${!isFirstRun ? ` <span class="text-gray-400 font-normal text-base">${t('settings.title')}</span>` : ''}
            </h2>
            ${isFirstRun ? `<p class="text-sm text-gray-500 mt-1">${t('setup.subtitle')}</p>` : ''}
        </div>
        <div class="space-y-5">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">${t('setup.name')}</label>
                <input type="text" id="setup-name" value="${name}" placeholder="${t('setup.name.placeholder')}"
                    class="w-full p-2.5 border rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">${t('setup.device')}</label>
                <div class="grid grid-cols-3 gap-3">
                    <div class="device-option ${device === 'garmin' ? 'selected' : ''}" data-device="garmin">
                        <div class="device-icon">⌚</div>
                        <div class="device-name">${t('setup.device.garmin')}</div>
                        <div class="device-desc">${t('setup.device.garmin.desc')}</div>
                    </div>
                    <div class="device-option ${device === 'apple' ? 'selected' : ''}" data-device="apple" ${state.platform === 'windows' ? 'style="display:none"' : ''}>
                        <div class="device-icon">⌚</div>
                        <div class="device-name">${t('setup.device.apple')}</div>
                        <div class="device-desc">${t('setup.device.apple.desc')}</div>
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
        const settings = { player_name: playerName, device_source: selectedDevice, sg_baseline: selectedSgBaseline, exclude_outliers: outliers };
        try {
            await saveSettings(settings);
            state.settings = settings;
            if (selectedLang !== getLang()) {
                setLang(selectedLang);
                onLangChange();
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

async function handleAppleSync() {
    if (state.syncing) return;
    state.syncing = true;

    const btn   = document.getElementById('apple-sync-btn');
    const label = document.getElementById('apple-sync-label');
    btn.disabled = true;
    label.textContent = t('sync.apple.syncing');

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
        state.syncing = false;
        btn.disabled = false;
        label.textContent = t('sync.apple.label');
    }
}

async function handleAndroidSync() {
    if (state.syncing) return;
    state.syncing = true;

    const btn   = document.getElementById('android-sync-btn');
    const label = document.getElementById('android-sync-label');
    btn.disabled = true;
    label.textContent = t('sync.android.syncing');

    try {
        const newSummaries = await syncAndroidRounds();
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));

        renderRoundsList();
        if (newSummaries.length > 0) loadDetail(newSummaries[0].id);
        toast(t('toast.synced', { count: newSummaries.length }));
        updateStats();
    } catch (e) {
        const msg = String(e).includes('not found') ? t('sync.android.notfound') : t('toast.syncfail', { err: e });
        toast(msg, true);
    } finally {
        state.syncing = false;
        btn.disabled = false;
        label.textContent = t('sync.android.label');
    }
}

async function handleSync() {
    if (state.syncing) return;
    state.syncing = true;
    state.syncOffset = 0;

    const btn   = document.getElementById('sync-btn');
    const label = document.getElementById('sync-label');
    btn.disabled = true;
    label.textContent = 'Syncing...';

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
        label.textContent = 'Sync Watch';
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

// ── Hamburger Menu ───────────────────────────────────────────────────────────

function initHamburgerMenu() {
    const btn = document.getElementById('hamburger-btn');
    const menu = document.getElementById('hamburger-menu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => menu.classList.add('hidden'));

    document.getElementById('menu-trends').addEventListener('click', () => {
        menu.classList.add('hidden');
        showTrendsView();
    });

    document.getElementById('menu-settings').addEventListener('click', () => {
        menu.classList.add('hidden');
        renderSetupModal(false);
    });
}

// ── Trends View ──────────────────────────────────────────────────────────────

async function showTrendsView() {
    state.activeView = 'trends';
    state.activeId = null;
    renderRoundsList();

    const content = document.getElementById('detail-content');
    const empty = document.getElementById('detail-empty');
    content.classList.remove('hidden');
    empty.classList.add('hidden');

    const summaryRounds = state.rounds.filter(r => r.total_score > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!summaryRounds.length) {
        content.innerHTML = buildTrendsPage();
        return;
    }

    // Show summary sections immediately, load detail sections async
    content.innerHTML = buildTrendsPage();
    requestAnimationFrame(() => {
        renderScoreTrendChart(summaryRounds);
        renderShortGameTrendChart(summaryRounds);
        renderFitnessTrendChart(summaryRounds);
    });

    // Load light rounds for SG + club trends
    try {
        const lightRounds = await getAllRoundsLight();
        if (state.activeView !== 'trends') return; // user navigated away

        const sgSection = document.getElementById('trends-sg-section');
        const clubSection = document.getElementById('trends-club-section');
        if (sgSection) {
            sgSection.innerHTML = buildSgTrends(lightRounds);
            requestAnimationFrame(() => renderSgTrendChart(lightRounds));
        }
        if (clubSection) {
            clubSection.innerHTML = buildClubTrends(lightRounds);
        }
    } catch (e) {
        console.error('Failed to load light rounds for trends:', e);
    }
}

function buildTrendsPage() {
    const rounds = state.rounds.filter(r => r.total_score > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!rounds.length) {
        return `<div class="flex flex-col items-center justify-center h-full text-gray-400 py-20">
            <span class="text-5xl mb-4">📊</span>
            <p class="text-lg">${t('trends.nodata')}</p>
        </div>`;
    }

    return `
    <div class="pt-6 pb-6 space-y-6">
        <div class="flex items-center justify-between">
            <h2 class="text-2xl font-bold text-gray-800">📊 ${t('trends.title')}</h2>
            <span class="text-sm text-gray-400">${t('trends.subtitle', { count: rounds.length })}</span>
        </div>
        ${buildScoringTrends(rounds)}
        ${buildShortGameTrends(rounds)}
        <div id="trends-sg-section"><div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('detail.loading')}</div></div>
        <div id="trends-club-section"><div class="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-400 py-8">${t('detail.loading')}</div></div>
        ${buildFitnessTrends(rounds)}
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

function buildClubTrends(lightRounds) {
    // Collect all non-putt shots across all rounds
    const clubMap = {}; // clubName → [{ distYds, dev, roundDate }]
    lightRounds.forEach(r => {
        const sc = r.scorecard;
        if (!sc?.hole_scores?.length) return;
        const dt = new Date((r.start_ts + GARMIN_EPOCH) * 1000);
        const dateLabel = `${dt.getMonth()+1}/${dt.getDate()}`;
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const green = shots[shots.length - 1].to;
            shots.forEach((shot, idx) => {
                const cat = shot.club_category ?? 'unknown';
                if (cat === 'putt') return;
                const name = shot.club_name ?? cat;
                const dist = metersToYards(distMeters(shot.from, shot.to));
                const shotBear = bearing(shot.from, shot.to);
                const greenBear = bearing(shot.from, green);
                const dev = deviation(shotBear, greenBear);
                if (!clubMap[name]) clubMap[name] = [];
                clubMap[name].push({ distYds: dist, dev, dateLabel, roundDate: r.start_ts });
            });
        });
    });

    const catOrder = { tee: 0, fairway_wood: 1, iron: 2, wedge: 3, unknown: 4 };
    const clubs = Object.entries(clubMap)
        .filter(([, shots]) => shots.length >= 3)
        .map(([name, shots]) => {
            const dists = shots.map(s => s.distYds);
            const { normal, excluded } = filterOutliers(dists);
            const avg = normal.length ? Math.round(normal.reduce((a, b) => a + b, 0) / normal.length) : 0;
            const max = normal.length ? Math.round(Math.max(...normal)) : 0;
            const straight = shots.filter(s => Math.abs(s.dev) < 15).length;
            // Determine category from first shot's club_category in any round
            let cat = 'unknown';
            for (const r of lightRounds) {
                const sc = r.scorecard;
                if (!sc) continue;
                for (const hs of sc.hole_scores) {
                    const s = hs.shots.find(s => s.club_name === name);
                    if (s?.club_category) { cat = s.club_category; break; }
                }
                if (cat !== 'unknown') break;
            }
            return { name, cat, shots: shots.length, avg, max, excluded: excluded.length, straightPct: Math.round(straight / shots.length * 100) };
        })
        .sort((a, b) => (catOrder[a.cat] ?? 4) - (catOrder[b.cat] ?? 4) || b.avg - a.avg);

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
    </div>`;
}

function onLangChange() {
    applyStaticTranslations();
    renderRoundsList();
    if (state.activeView === 'trends') showTrendsView();
    else if (state.activeRound) renderDetailTabs();
    updateStats();
}

async function init() {
    document.getElementById('sync-btn').addEventListener('click', handleSync);
    document.getElementById('apple-sync-btn')?.addEventListener('click', handleAppleSync);
    document.getElementById('android-sync-btn')?.addEventListener('click', handleAndroidSync);
    document.getElementById('search-input').addEventListener('input', e => {
        state.searchTerm = e.target.value.toLowerCase();
        renderRoundsList();
    });

    initHamburgerMenu();
    applyStaticTranslations();

    // Check first-run: load settings
    try {
        state.platform = await getPlatform().catch(() => 'unknown');
        const settings = await getSettings();
        if (!settings || !settings.device_source) {
            // First run — show setup modal, don't load data yet
            renderSetupModal(true);
            return;
        }
        state.settings = settings;
        applySyncButtonVisibility();
        await loadInitialData();
    } catch (e) {
        console.error('Init error:', e);
        // If settings fetch fails, show setup anyway
        renderSetupModal(true);
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
    document.getElementById('menu-trends-label').textContent = t('menu.trends');
    document.getElementById('menu-settings-label').textContent = t('menu.settings');
}

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
