// ── NLG Engine ────────────────────────────────────────────────────────────────
// Evaluates NLG_TEMPLATES against an analytics context object,
// ranks by severity + tier, and returns top N insights.

import { NLG_TEMPLATES } from './nlg-templates.js';
import { getLang, t } from './i18n.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, positive: 2, info: 3 };

// SG consistency rule (issue #20): a weakness claim must not contradict
// strokes-gained data. If the SG category a claim is about is at or above
// SG_CONTRADICTS, the weakness insight is dropped. Only weakness severities
// are filtered; positive and info insights pass through. Missing SG data
// fails open (the insight stands).
const SG_CONTRADICTS = 1.0;

// Insight codes that blame a category, mapped to the SG category they describe.
// Deliberately unmapped: PATTERN_FATIGUE_LATE_RELEASE, PATTERN_MENTAL_SNOWBALL,
// PATTERN_SCORE_ANXIETY_COLLAPSE, PATTERN_PAR5_OVERAGGRESSIVE,
// PATTERN_COURSE_RATING_STRESS (no SG counterpart), and THREE_PUTTS (a count
// fact, not a category judgement).
const INSIGHT_SG_CATEGORY = {
    PATTERN_DRIVER_PULL_HOOK:        'off_tee',
    PATTERN_DRIVER_SLICE:            'off_tee',
    PATTERN_TEE_TEMPO_RUSH:          'off_tee',
    PATTERN_IRON_CONTACT_ERROR:      'approach',
    PATTERN_MID_RANGE_INCONSISTENCY: 'approach',
    PATTERN_WEDGE_DISTANCE_CONTROL:  'short_game',
    PATTERN_BUNKER_ESCAPE:           'short_game',
    POOR_SCRAMBLING:                 'short_game',
    PATTERN_PUTTING_3PUTT:           'putting',
    PATTERN_LONG_PUTT_TEMPO:         'putting',
    PATTERN_SHORT_PUTT_ALIGNMENT:    'putting',
};

export function isSgContradicted(insight, ctx) {
    if (insight.severity !== 'critical' && insight.severity !== 'warning') return false;
    const cat = INSIGHT_SG_CATEGORY[insight.code];
    if (!cat) return false;
    const sg = ctx?.sg?.categories?.[cat];
    return typeof sg === 'number' && sg >= SG_CONTRADICTS;
}

// Evaluate all templates against context, return ranked insights
export function generateInsights(ctx, maxInsights = 6) {
    if (!ctx) return [];
    const lang = getLang();

    const fired = [];
    for (const tpl of NLG_TEMPLATES) {
        try {
            if (tpl.condition(ctx)) {
                // Support both old array format and new {en:[],ko:[]} format
                let msgArr;
                if (Array.isArray(tpl.messages)) {
                    msgArr = tpl.messages;
                } else {
                    msgArr = tpl.messages[lang] ?? tpl.messages.en;
                }
                const msg = msgArr[Math.floor(Math.random() * msgArr.length)](ctx);
                const severity = typeof tpl.severity === 'function' ? tpl.severity(ctx) : tpl.severity;
                fired.push({ code: tpl.code, severity, tier: tpl.tier, message: msg });
            }
        } catch (_) { /* skip if data missing */ }
    }

    // SG consistency: drop weakness claims contradicted by SG before ranking,
    // so a suppressed insight never takes a card slot.
    const consistent = fired.filter(f => !isSgContradicted(f, ctx));

    // Sort: tier first, then severity
    consistent.sort((a, b) =>
        a.tier !== b.tier ? a.tier - b.tier :
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );

    // Cap: max 2 positives, rest critical/warning/info
    const positives = consistent.filter(f => f.severity === 'positive').slice(0, 2);
    const others    = consistent.filter(f => f.severity !== 'positive').slice(0, maxInsights - positives.length);
    return [...others, ...positives].slice(0, maxInsights);
}

const SEVERITY_ICON = {
    critical: '🔴', warning: '🟡', positive: '🟢', info: '🔵'
};

// Render insights as an HTML card
export function buildInsightsCard(ctx) {
    const insights = generateInsights(ctx, 7);
    if (!insights.length) return '';

    const fb = ctx.feedback ?? {};
    const items = insights.map(i => {
        const stored = fb[i.code];  // true | false | undefined
        const upCls   = stored === true  ? 'text-green-500' : 'text-gray-300';
        const downCls = stored === false ? 'text-red-400'   : 'text-gray-300';
        return `
        <div class="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0" data-insight-code="${i.code}">
            <span class="text-base flex-shrink-0 mt-0.5">${SEVERITY_ICON[i.severity]}</span>
            <p class="text-sm text-gray-700 leading-relaxed flex-1">${i.message}</p>
            <span class="flex gap-1 flex-shrink-0 mt-0.5">
                <button data-feedback="up"   data-code="${i.code}" class="${upCls}   hover:text-green-500 transition-colors text-sm leading-none" title="Helpful">👍</button>
                <button data-feedback="down" data-code="${i.code}" class="${downCls} hover:text-red-400  transition-colors text-sm leading-none" title="Not helpful">👎</button>
            </span>
        </div>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">${t('insights.title')}</h3>
        <p class="text-xs text-gray-400 mb-4">${t('insights.desc')}</p>
        ${items}
    </div>`;
}

// Plain text version for AI prompt
export function buildInsightsText(ctx) {
    const insights = generateInsights(ctx, 10);
    if (!insights.length) return '';
    return insights.map(i => `[${i.severity.toUpperCase()}] ${i.message}`).join('\n');
}
