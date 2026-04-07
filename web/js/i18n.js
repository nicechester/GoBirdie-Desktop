// ── i18n Module ──────────────────────────────────────────────────────────────
// Provides translations for EN/KO and a language selector with flag icons.

const STORAGE_KEY = 'garmin-golf-lang';

let currentLang = localStorage.getItem(STORAGE_KEY) || 'en';

export function getLang() { return currentLang; }

export function setLang(lang) {
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
}

export function t(key, params = {}) {
    const str = (STRINGS[currentLang]?.[key] ?? STRINGS.en[key] ?? key);
    return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

// ── UI Strings ───────────────────────────────────────────────────────────────

export const STRINGS = {
    en: {
        // Header
        'app.title': 'Garmin Golf Analyzer',
        'sync.label': 'Sync Watch',
        'sync.syncing': 'Syncing...',
        'rounds.stored': '{count} round{s} stored',

        // Sidebar
        'search.placeholder': 'Search rounds...',
        'rounds.empty': 'No rounds yet.<br>Connect your watch and click Sync.',
        'rounds.notfound': 'No rounds found.',
        'rounds.loadmore': 'Load 10 more...',

        // Detail
        'detail.select': 'Select a round to view details',
        'detail.loading': 'Loading...',
        'detail.notfound': 'Round not found.',

        // Tabs
        'tab.overview': 'Overview',
        'tab.shotmap': 'Shot Map',
        'tab.stats': 'Course Stats',
        'tab.sg': 'Shot Analysis',
        'btn.askai': 'Ask AI',

        // Overview cards
        'stat.minutes': 'Minutes',
        'stat.kmwalked': 'km walked',
        'stat.avghr': 'Avg HR',
        'stat.calories': 'Calories',
        'stat.altitude': 'Altitude',
        'stat.avgtempo': 'Avg Tempo',
        'stat.ascent': 'Ascent: {v} m',
        'stat.descent': 'Descent: {v} m',

        // Scorecard
        'scorecard.title': 'Scorecard',
        'scorecard.putts': 'Putts',
        'scorecard.gir': 'GIR',
        'scorecard.fairways': 'Fairways Hit',
        'scorecard.holes': 'Holes',
        'scorecard.hole': 'Hole',
        'scorecard.par': 'Par',
        'scorecard.hdcp': 'Hdcp',
        'scorecard.yds': 'Yds',
        'scorecard.score': 'Score',
        'scorecard.fw': 'FW',
        'scorecard.shots': 'Shots',
        'scorecard.total': 'Total',

        // Health
        'health.title': 'Health During Round',
        'health.avgmaxhr': 'Avg / Max HR (bpm)',
        'health.bodybattery': 'Body Battery (−{drain}%)',
        'health.avgpeakstress': 'Avg / Peak Stress',

        // HR Zones
        'hrzones.title': 'HR Zones',

        // Shot Map
        'shotmap.title': 'Shot Map',
        'shotmap.hole': 'Hole:',
        'shotmap.all': 'All',
        'shotmap.trail': 'Trail',
        'shotmap.nodata': 'No shot data available.',
        'shotmap.timeline.title': 'Round Timeline',
        'shotmap.timeline.desc': 'Select a hole above to zoom in. HR, altitude and stress over time.',

        // Course Stats
        'stats.nodata': 'No scorecard data available.',
        'stats.teeshots': 'Tee Shots',
        'stats.approach': 'Approach Shots',
        'stats.wedges': 'Wedges',
        'stats.avg': 'Avg (yds)',
        'stats.max': 'Max (yds)',
        'stats.straight': 'Straight',
        'stats.shot': 'Shot',
        'stats.club': 'Club',
        'stats.dist': 'Dist',
        'stats.direction': 'Direction',
        'stats.hr': 'HR',
        'stats.putting.title': 'Putting',
        'stats.putting.total': 'total',
        'stats.putting.perhole': 'Per hole',
        'stats.putting.oneputts': '1-putts',
        'stats.putting.twoputts': '2-putts',
        'stats.putting.threeputts': '3-putts',
        'stats.clubsummary': 'Club Summary',
        'stats.avgdist': 'Avg Distance',
        'stats.straightpct': 'Straight%',

        // Strokes Gained
        'sg.title': 'Strokes Gained',
        'sg.desc': 'Based on Mark Broadie\'s Every Shot Counts · single-digit handicap baseline',
        'sg.total': 'Total SG',
        'sg.offtee': 'Off the Tee',
        'sg.approach': 'Approach',
        'sg.shortgame': 'Short Game',
        'sg.putting': 'Putting',
        'sg.bestshots': '🏆 Best Shots',
        'sg.worstshots': '💀 Worst Shots',
        'sg.perhole': 'Per-Hole Breakdown',
        'sg.howworks.title': 'How Strokes Gained Works',
        'sg.howworks.p1': 'Strokes Gained, developed by Mark Broadie in <i>Every Shot Counts</i>, measures each shot\'s value by comparing your result to what a benchmark golfer (here, a single-digit handicap) would expect from the same position.',
        'sg.howworks.p2': '<b>SG = Expected strokes before − 1 − Expected strokes after.</b> A positive value means you gained strokes (did better than baseline); negative means you lost strokes.',
        'sg.howworks.offtee': '<span class="font-medium text-gray-600">SG: Off the Tee</span> — Tee shots on par 4s and 5s',
        'sg.howworks.approach': '<span class="font-medium text-gray-600">SG: Approach</span> — Shots into the green from 50+ yards',
        'sg.howworks.shortgame': '<span class="font-medium text-gray-600">SG: Short Game</span> — Non-putt shots within 50 yards',
        'sg.howworks.putting': '<span class="font-medium text-gray-600">SG: Putting</span> — All putts on the green',
        'sg.howworks.note': 'Lie detection is approximate — fairway/rough is inferred from the fairway-hit flag on tee shots. Baseline data is interpolated from Broadie\'s published single-digit handicap tables.',
        'sg.nodata': 'No scorecard data for Strokes Gained analysis.',

        // Club Analysis
        'clubanalysis.title': 'Club Analysis',
        'clubanalysis.desc': 'Mis-shot tendency and consistency per club (min 2 shots)',
        'clubanalysis.consistency': 'Consistency',
        'clubanalysis.tendency': 'Tendency',
        'clubanalysis.avgsg': 'Avg SG',
        'clubanalysis.veryconsistent': 'Very consistent',
        'clubanalysis.consistent': 'Consistent',
        'clubanalysis.moderate': 'Moderate',
        'clubanalysis.inconsistent': 'Inconsistent',
        'clubanalysis.neutral': 'Neutral',
        'clubanalysis.leftbias': 'Left bias ({deg}°)',
        'clubanalysis.rightbias': 'Right bias (+{deg}°)',

        // Dispersion
        'dispersion.title': 'Shot Dispersion',
        'dispersion.desc': 'Where your shots land relative to target — count and avg SG per cell. Grouped by distance to green.',

        // Insights
        'insights.title': 'Key Insights',
        'insights.desc': 'Rule-based analysis of your round',

        // Toast
        'toast.synced': 'Synced {count} round(s)',
        'toast.loaded': 'Loaded {count} more round(s)',
        'toast.syncfail': 'Sync failed: {err}',
        'toast.loadfail': 'Load failed: {err}',
        'toast.copied': 'Prompt copied! Paste it on gemini.google.com or chatgpt.com',

        // Direction labels
        'dir.straight': 'Straight',
        'dir.right': 'Right',
        'dir.left': 'Left',
        'dir.farright': 'Far Right',
        'dir.farleft': 'Far Left',
        'dir.farr': 'Far R',
        'dir.farl': 'Far L',
        'dir.waylong': 'Way Long',
        'dir.long': 'Long',
        'dir.good': 'Good',
        'dir.short': 'Short',
        'dir.wayshort': 'Way Short',
    },

    ko: {
        // Header
        'app.title': '가민 골프 분석기',
        'sync.label': '워치 동기화',
        'sync.syncing': '동기화 중...',
        'rounds.stored': '{count}개 라운드 저장됨',

        // Sidebar
        'search.placeholder': '라운드 검색...',
        'rounds.empty': '라운드가 없습니다.<br>워치를 연결하고 동기화를 클릭하세요.',
        'rounds.notfound': '라운드를 찾을 수 없습니다.',
        'rounds.loadmore': '10개 더 불러오기...',

        // Detail
        'detail.select': '라운드를 선택하여 상세 정보를 확인하세요',
        'detail.loading': '로딩 중...',
        'detail.notfound': '라운드를 찾을 수 없습니다.',

        // Tabs
        'tab.overview': '개요',
        'tab.shotmap': '샷 맵',
        'tab.stats': '코스 통계',
        'tab.sg': '샷 분석',
        'btn.askai': 'AI에게 물어보기',

        // Overview cards
        'stat.minutes': '분',
        'stat.kmwalked': 'km 걸음',
        'stat.avghr': '평균 심박수',
        'stat.calories': '칼로리',
        'stat.altitude': '고도',
        'stat.avgtempo': '평균 템포',
        'stat.ascent': '상승: {v} m',
        'stat.descent': '하강: {v} m',

        // Scorecard
        'scorecard.title': '스코어카드',
        'scorecard.putts': '퍼팅',
        'scorecard.gir': 'GIR',
        'scorecard.fairways': '페어웨이 안착',
        'scorecard.holes': '홀',
        'scorecard.hole': '홀',
        'scorecard.par': '파',
        'scorecard.hdcp': '핸디캡',
        'scorecard.yds': '야드',
        'scorecard.score': '스코어',
        'scorecard.fw': 'FW',
        'scorecard.shots': '샷',
        'scorecard.total': '합계',

        // Health
        'health.title': '라운드 중 건강 데이터',
        'health.avgmaxhr': '평균 / 최대 심박수 (bpm)',
        'health.bodybattery': '바디 배터리 (−{drain}%)',
        'health.avgpeakstress': '평균 / 최고 스트레스',

        // HR Zones
        'hrzones.title': '심박수 구간',

        // Shot Map
        'shotmap.title': '샷 맵',
        'shotmap.hole': '홀:',
        'shotmap.all': '전체',
        'shotmap.trail': '이동 경로',
        'shotmap.nodata': '샷 데이터가 없습니다.',
        'shotmap.timeline.title': '라운드 타임라인',
        'shotmap.timeline.desc': '위에서 홀을 선택하면 확대됩니다. 심박수, 고도, 스트레스 추이.',

        // Course Stats
        'stats.nodata': '스코어카드 데이터가 없습니다.',
        'stats.teeshots': '티샷',
        'stats.approach': '어프로치 샷',
        'stats.wedges': '웨지',
        'stats.avg': '평균 (야드)',
        'stats.max': '최대 (야드)',
        'stats.straight': '직진',
        'stats.shot': '샷',
        'stats.club': '클럽',
        'stats.dist': '거리',
        'stats.direction': '방향',
        'stats.hr': '심박수',
        'stats.putting.title': '퍼팅',
        'stats.putting.total': '합계',
        'stats.putting.perhole': '홀당',
        'stats.putting.oneputts': '1퍼팅',
        'stats.putting.twoputts': '2퍼팅',
        'stats.putting.threeputts': '3퍼팅',
        'stats.clubsummary': '클럽 요약',
        'stats.avgdist': '평균 거리',
        'stats.straightpct': '직진율',

        // Strokes Gained
        'sg.title': '스트로크 게인드',
        'sg.desc': 'Mark Broadie의 Every Shot Counts 기반 · 싱글 핸디캡 기준선',
        'sg.total': '총 SG',
        'sg.offtee': '티샷',
        'sg.approach': '어프로치',
        'sg.shortgame': '숏게임',
        'sg.putting': '퍼팅',
        'sg.bestshots': '🏆 최고의 샷',
        'sg.worstshots': '💀 최악의 샷',
        'sg.perhole': '홀별 분석',
        'sg.howworks.title': '스트로크 게인드란?',
        'sg.howworks.p1': '스트로크 게인드는 Mark Broadie가 <i>Every Shot Counts</i>에서 개발한 지표로, 같은 위치에서 기준 골퍼(여기서는 싱글 핸디캡)가 기대하는 결과와 비교하여 각 샷의 가치를 측정합니다.',
        'sg.howworks.p2': '<b>SG = 이전 기대 타수 − 1 − 이후 기대 타수.</b> 양수는 기준보다 잘한 것, 음수는 기준보다 못한 것을 의미합니다.',
        'sg.howworks.offtee': '<span class="font-medium text-gray-600">SG: 티샷</span> — 파4, 파5 홀의 티샷',
        'sg.howworks.approach': '<span class="font-medium text-gray-600">SG: 어프로치</span> — 50야드 이상에서 그린을 향한 샷',
        'sg.howworks.shortgame': '<span class="font-medium text-gray-600">SG: 숏게임</span> — 50야드 이내 퍼팅 제외 샷',
        'sg.howworks.putting': '<span class="font-medium text-gray-600">SG: 퍼팅</span> — 그린 위의 모든 퍼팅',
        'sg.howworks.note': '라이 판별은 근사치입니다 — 페어웨이/러프는 티샷의 페어웨이 안착 여부로 추정합니다. 기준 데이터는 Broadie의 싱글 핸디캡 테이블에서 보간됩니다.',
        'sg.nodata': '스트로크 게인드 분석을 위한 스코어카드 데이터가 없습니다.',

        // Club Analysis
        'clubanalysis.title': '클럽 분석',
        'clubanalysis.desc': '클럽별 미스샷 경향 및 일관성 (최소 2샷)',
        'clubanalysis.consistency': '일관성',
        'clubanalysis.tendency': '경향',
        'clubanalysis.avgsg': '평균 SG',
        'clubanalysis.veryconsistent': '매우 일관적',
        'clubanalysis.consistent': '일관적',
        'clubanalysis.moderate': '보통',
        'clubanalysis.inconsistent': '불일관적',
        'clubanalysis.neutral': '중립',
        'clubanalysis.leftbias': '좌측 편향 ({deg}°)',
        'clubanalysis.rightbias': '우측 편향 (+{deg}°)',

        // Dispersion
        'dispersion.title': '샷 분산도',
        'dispersion.desc': '목표 대비 샷 착지 위치 — 셀당 횟수 및 평균 SG. 그린까지 거리별 그룹.',

        // Insights
        'insights.title': '핵심 인사이트',
        'insights.desc': '규칙 기반 라운드 분석',

        // Toast
        'toast.synced': '{count}개 라운드 동기화 완료',
        'toast.loaded': '{count}개 라운드 추가 로드',
        'toast.syncfail': '동기화 실패: {err}',
        'toast.loadfail': '로드 실패: {err}',
        'toast.copied': '프롬프트 복사 완료! gemini.google.com 또는 chatgpt.com에 붙여넣기하세요',

        // Direction labels
        'dir.straight': '직진',
        'dir.right': '우측',
        'dir.left': '좌측',
        'dir.farright': '극우측',
        'dir.farleft': '극좌측',
        'dir.farr': '극우',
        'dir.farl': '극좌',
        'dir.waylong': '매우 길게',
        'dir.long': '길게',
        'dir.good': '적정',
        'dir.short': '짧게',
        'dir.wayshort': '매우 짧게',
    }
};

// ── Language Selector ────────────────────────────────────────────────────────

const FLAGS = {
    en: `<svg width="24" height="16" viewBox="0 0 24 16" style="border-radius:2px;box-shadow:0 0 1px rgba(0,0,0,0.3)">
        <rect width="24" height="16" fill="#B22234"/>
        <rect y="1.23" width="24" height="1.23" fill="white"/>
        <rect y="3.69" width="24" height="1.23" fill="white"/>
        <rect y="6.15" width="24" height="1.23" fill="white"/>
        <rect y="8.62" width="24" height="1.23" fill="white"/>
        <rect y="11.08" width="24" height="1.23" fill="white"/>
        <rect y="13.54" width="24" height="1.23" fill="white"/>
        <rect width="9.6" height="8.62" fill="#3C3B6E"/>
    </svg>`,
    ko: `<img src="data:image/png;base64,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" width="24" height="16" alt="한국어" style="border-radius:2px;box-shadow:0 0 1px rgba(0,0,0,0.3);object-fit:cover">`
};

export function initLangSelector(onLangChange) {
    const container = document.getElementById('lang-selector');
    if (!container) return;

    const render = () => {
        const otherLang = currentLang === 'en' ? 'ko' : 'en';
        container.innerHTML = `
            <button id="lang-toggle" class="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200
                hover:bg-gray-50 transition text-sm" title="Switch language">
                ${FLAGS[currentLang]}
                <span class="text-xs text-gray-500">▾</span>
            </button>`;

        container.querySelector('#lang-toggle').addEventListener('click', () => {
            setLang(otherLang);
            render();
            if (onLangChange) onLangChange();
        });
    };
    render();
}
