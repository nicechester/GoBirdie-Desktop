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
        'app.title': 'Desktop',
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
        'tab.stats': 'Club Performances',
        'tab.sg': 'Shot Analysis',
        'btn.askai': 'Ask AI',

        // Overview cards
        'stat.minutes': 'Minutes',
        'stat.kmwalked': 'km walked',
        'stat.avghr': 'Avg HR',
        'stat.calories': 'Calories',
        'stat.altitude': 'Altitude',
        'stat.avgtempo': 'Avg Tempo',
        'stat.ascent': 'Ascent: {v} ft',
        'stat.descent': 'Descent: {v} ft',

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
        'sg.desc': 'Based on Mark Broadie\'s Every Shot Counts · {baseline} baseline',
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

        // AI Prompt
        'ai.intro': 'Please analyze my golf round comprehensively and provide insights on performance, patterns, and areas for improvement.',
        'ai.roundsummary': '## Round Summary',
        'ai.date': 'Date', 'ai.course': 'Course', 'ai.score': 'Score',
        'ai.holes': 'Holes', 'ai.duration': 'Duration', 'ai.distance': 'Distance',
        'ai.calories': 'Calories', 'ai.avghr': 'Avg HR', 'ai.maxhr': 'Max HR',
        'ai.altitude': 'Altitude', 'ai.avgtempo': 'Avg swing tempo',
        'ai.scorecard': '## Hole-by-Hole Scorecard',
        'ai.sc.hole': 'Hole', 'ai.sc.par': 'Par', 'ai.sc.score': 'Score',
        'ai.sc.diff': '+/-', 'ai.sc.putts': 'Putts', 'ai.sc.fw': 'FW',
        'ai.sc.shots': 'Shots', 'ai.sc.clubs': 'Clubs', 'ai.sc.total': 'Total', 'ai.sc.na': 'n/a',
        'ai.shotdetails': '## Shot Details', 'ai.shot': 'Shot',
        'ai.insights': '## Pre-computed Insights',
        'ai.sg': '## Strokes Gained ({baseline} baseline)',
        'ai.sg.total': 'Total', 'ai.sg.pershot': '\nPer-shot SG:',
        'ai.sg.hole': 'Hole', 'ai.sg.dist': 'Dist',
        'ai.sg.cats.off_tee': 'Off the Tee', 'ai.sg.cats.approach': 'Approach',
        'ai.sg.cats.short_game': 'Short Game', 'ai.sg.cats.putting': 'Putting',
        'ai.clubanalysis': '## Club Analysis (Tendency & Consistency)',
        'ai.club.avgdist': 'Avg Dist', 'ai.club.stddev': 'Std Dev',
        'ai.club.avgdev': 'Avg Deviation', 'ai.club.left': 'Left%',
        'ai.club.straight': 'Straight%', 'ai.club.right': 'Right%', 'ai.club.avgsg': 'Avg SG',
        'ai.dispersion': '## Shot Dispersion Patterns',
        'ai.disp.direction': 'Direction', 'ai.disp.avg': 'avg',
        'ai.disp.left': 'left', 'ai.disp.straight': 'straight', 'ai.disp.right': 'right',
        'ai.disp.distance': 'Distance', 'ai.disp.oftarget': '% of target',
        'ai.disp.short': 'short', 'ai.disp.good': 'good', 'ai.disp.long': 'long',
        'ai.health': '## Health & Wellness Summary',
        'ai.health.bb': 'Body Battery', 'ai.health.drained': 'drained',
        'ai.health.stress': 'Stress', 'ai.health.avg': 'avg', 'ai.health.peak': 'peak',
        'ai.timeline': '## Health Timeline (1-min intervals)',
        'ai.timeline.time': 'Time', 'ai.timeline.hr': 'HR (bpm)',
        'ai.timeline.alt': 'Altitude (m)', 'ai.timeline.stress': 'Stress', 'ai.timeline.tempo': 'Tempo',
        'ai.closing': 'Please provide: 1) Overall performance summary, 2) Strengths, 3) Areas for improvement, 4) Patterns (tempo, HR, stress vs score), 5) Specific recommendations.',

        // Toast
        'toast.synced': 'Synced {count} round(s)',
        'toast.loaded': 'Loaded {count} more round(s)',
        'toast.syncfail': 'Sync failed: {err}',
        'toast.loadfail': 'Load failed: {err}',
        'toast.copied': 'Prompt copied! Paste it on gemini.google.com or chatgpt.com',
        'toast.deleted': 'Round deleted',
        'toast.deletefail': 'Delete failed: {err}',

        // Context menu
        'ctx.delete': '🗑 Delete Round',
        'delete.title': 'Delete Round?',
        'delete.msg': 'Are you sure you want to delete <b>{name}</b>? This cannot be undone.',
        'delete.cancel': 'Cancel',
        'delete.confirm': 'Delete',

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

        // Settings / Setup
        'setup.title': 'Welcome to GoBirdie',
        'setup.subtitle': 'Let\'s get you set up before your first round.',
        'setup.name': 'Your Name',
        'setup.name.placeholder': 'e.g. Chester',
        'setup.device': 'How do you track your rounds?',
        'setup.device.garmin': 'Garmin Watch',
        'setup.device.garmin.desc': 'Sync via USB cable',
        'setup.device.apple': 'Apple Watch',
        'setup.device.apple.desc': 'Sync over local WiFi',
        'setup.device.android': 'Android',
        'setup.device.android.desc': 'Sync over local WiFi',
        'setup.save': 'Get Started',
        'setup.validation': 'Please enter your name and select a device.',
        'settings.title': 'Settings',
        'settings.save': 'Save',
        'settings.language': 'Language',
        'settings.sgbaseline': 'Strokes Gained Baseline',
        'settings.sgbaseline.desc': 'Compare your shots against this handicap level.',
        'settings.sg.scratch': 'Scratch',
        'settings.sg.handicap': '{v} HCP',
        'settings.outliers': 'Exclude outlier shots',
        'settings.outliers.desc': 'Filter out shanks, tops, and GPS errors from club distance stats using IQR.',

        // Menu
        'menu.trends': 'Trends',
        'menu.settings': 'Settings',

        // Trends
        'trends.title': 'Performance Trends',
        'trends.subtitle': '{count} rounds',
        'trends.nodata': 'No scored rounds yet. Sync some rounds to see trends.',
        'trends.coming': 'Coming Soon',
        'trends.coming.desc': 'Scoring trends, club performance, strokes gained history, and fitness tracking across all your rounds.',
        'trends.scoring': 'Scoring Trends',
        'trends.best': 'Best',
        'trends.avgscore': 'Avg Score',
        'trends.avgoverpar': 'Avg Over Par',
        'trends.trend': 'Trend',
        'trends.overpar': 'Over Par',
        'trends.movingavg': '5-Round Avg',
        'trends.shortgame': 'Short Game & Putting',
        'trends.puttsperhole': 'Putts / Hole',
        'trends.avggir': 'Avg GIR',
        'trends.avgfir': 'Avg FIR',
        'trends.putts': 'Putts',
        'trends.fitness': 'Fitness & Health',
        'trends.avghr': 'Avg HR',
        'trends.avgcal': 'Avg Calories',
        'trends.avgtempo': 'Avg Tempo',
        'trends.hr': 'HR (bpm)',
        'trends.calories': 'Calories',
        'trends.tempo': 'Tempo',
        'trends.sg.title': 'Strokes Gained Trends',
        'trends.sg.avgtotal': 'Avg Total SG',
        'trends.sg.strongest': 'Strongest',
        'trends.sg.weakest': 'Weakest',
        'trends.sg.nodata': 'Not enough rounds for SG trends.',
        'trends.club.title': 'Club Performance (All Rounds)',
        'trends.club.desc': 'Aggregated across all rounds. Outlier shots (shanks/layups) excluded from avg distance.',
        'trends.club.avgdist': 'Avg Distance',
        'trends.club.excl': 'excl',
        'trends.club.nodata': 'Not enough club data for trends.',
        'trends.clubdetail.title': 'Club Detail Trends',
        'trends.clubdetail.avgdev': 'Avg Deviation (°)',
        'trends.clubdetail.deviation': 'Deviation (°)',
        'trends.last': 'Last',

        // Apple sync
        'sync.apple.notfound': 'iPhone not found on network',
        'sync.android.label': 'Sync Android',
        'sync.android.syncing': 'Syncing...',
        'sync.android.notfound': 'Android phone not found on network. Enable Sync Server in GoBirdie Settings.',
    },

    ko: {
        // Header
        'app.title': 'Desktop',
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
        'tab.stats': '클럽 성적',
        'tab.sg': '샷 분석',
        'btn.askai': 'AI에게 물어보기',

        // Overview cards
        'stat.minutes': '분',
        'stat.kmwalked': 'km 걸음',
        'stat.avghr': '평균 심박수',
        'stat.calories': '칼로리',
        'stat.altitude': '고도',
        'stat.avgtempo': '평균 템포',
        'stat.ascent': '상승: {v} ft',
        'stat.descent': '하강: {v} ft',

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
        'sg.desc': 'Mark Broadie의 Every Shot Counts 기반 · {baseline} 기준선',
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

        // AI Prompt
        'ai.intro': '제 골프 라운드를 종합적으로 분석하고 성적, 패턴, 개선 영역에 대한 인사이트를 제공해 주세요.',
        'ai.roundsummary': '## 라운드 요약',
        'ai.date': '날짜', 'ai.course': '코스', 'ai.score': '스코어',
        'ai.holes': '홀', 'ai.duration': '시간', 'ai.distance': '거리',
        'ai.calories': '칼로리', 'ai.avghr': '평균 심박수', 'ai.maxhr': '최대 심박수',
        'ai.altitude': '고도', 'ai.avgtempo': '평균 스윙 템포',
        'ai.scorecard': '## 홀별 스코어카드',
        'ai.sc.hole': '홀', 'ai.sc.par': '파', 'ai.sc.score': '스코어',
        'ai.sc.diff': '+/-', 'ai.sc.putts': '퍼팅', 'ai.sc.fw': 'FW',
        'ai.sc.shots': '샷', 'ai.sc.clubs': '클럽', 'ai.sc.total': '합계', 'ai.sc.na': '해당없음',
        'ai.shotdetails': '## 샷 상세', 'ai.shot': '샷',
        'ai.insights': '## 사전 분석 인사이트',
        'ai.sg': '## 스트로크 게인드 ({baseline} 기준선)',
        'ai.sg.total': '합계', 'ai.sg.pershot': '\n샷별 SG:',
        'ai.sg.hole': '홀', 'ai.sg.dist': '거리',
        'ai.sg.cats.off_tee': '티샷', 'ai.sg.cats.approach': '어프로치',
        'ai.sg.cats.short_game': '숏게임', 'ai.sg.cats.putting': '퍼팅',
        'ai.clubanalysis': '## 클럽 분석 (경향 및 일관성)',
        'ai.club.avgdist': '평균 거리', 'ai.club.stddev': '표준편차',
        'ai.club.avgdev': '평균 편차', 'ai.club.left': '좌측%',
        'ai.club.straight': '직진%', 'ai.club.right': '우측%', 'ai.club.avgsg': '평균 SG',
        'ai.dispersion': '## 샷 분산 패턴',
        'ai.disp.direction': '방향', 'ai.disp.avg': '평균',
        'ai.disp.left': '좌측', 'ai.disp.straight': '직진', 'ai.disp.right': '우측',
        'ai.disp.distance': '거리', 'ai.disp.oftarget': '% 목표 대비',
        'ai.disp.short': '짧음', 'ai.disp.good': '적정', 'ai.disp.long': '길음',
        'ai.health': '## 건강 및 웰니스 요약',
        'ai.health.bb': '바디 배터리', 'ai.health.drained': '소모',
        'ai.health.stress': '스트레스', 'ai.health.avg': '평균', 'ai.health.peak': '최고',
        'ai.timeline': '## 건강 타임라인 (1분 간격)',
        'ai.timeline.time': '시간', 'ai.timeline.hr': '심박수 (bpm)',
        'ai.timeline.alt': '고도 (m)', 'ai.timeline.stress': '스트레스', 'ai.timeline.tempo': '템포',
        'ai.closing': '다음 항목을 제공해 주세요: 1) 전체 성적 요약, 2) 강점, 3) 개선 영역, 4) 패턴 분석 (템포, 심박수, 스트레스 vs 스코어), 5) 구체적인 권고사항.',

        // Toast
        'toast.synced': '{count}개 라운드 동기화 완료',
        'toast.loaded': '{count}개 라운드 추가 로드',
        'toast.syncfail': '동기화 실패: {err}',
        'toast.loadfail': '로드 실패: {err}',
        'toast.copied': '프롬프트 복사 완료! gemini.google.com 또는 chatgpt.com에 붙여넣기하세요',
        'toast.deleted': '라운드 삭제 완료',
        'toast.deletefail': '삭제 실패: {err}',

        // Context menu
        'ctx.delete': '🗑 라운드 삭제',
        'delete.title': '라운드를 삭제하시겠습니까?',
        'delete.msg': '<b>{name}</b>을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
        'delete.cancel': '취소',
        'delete.confirm': '삭제',

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

        // Settings / Setup
        'setup.title': 'GoBirdie에 오신 것을 환영합니다',
        'setup.subtitle': '첫 라운드 전에 설정을 완료하세요.',
        'setup.name': '이름',
        'setup.name.placeholder': '예: 홍길동',
        'setup.device': '라운드를 어떻게 기록하시나요?',
        'setup.device.garmin': '가민 워치',
        'setup.device.garmin.desc': 'USB 케이블로 동기화',
        'setup.device.apple': '애플 워치',
        'setup.device.apple.desc': '로컬 WiFi로 동기화',
        'setup.device.android': '안드로이드',
        'setup.device.android.desc': '로컬 WiFi로 동기화',
        'setup.save': '시작하기',
        'setup.validation': '이름을 입력하고 기기를 선택해 주세요.',
        'settings.title': '설정',
        'settings.save': '저장',
        'settings.language': '언어',
        'settings.sgbaseline': '스트로크 게인드 기준선',
        'settings.sgbaseline.desc': '이 핸디캅 수준과 비교합니다.',
        'settings.sg.scratch': '스크래치',
        'settings.sg.handicap': '{v} 핸디캅',
        'settings.outliers': '이상치 샷 제외',
        'settings.outliers.desc': '상크, 탑, GPS 오류 등을 IQR 기반으로 클럽 거리 통계에서 제외합니다.',

        // Menu
        'menu.trends': '트렌드',
        'menu.settings': '설정',

        // Trends
        'trends.title': '성적 트렌드',
        'trends.subtitle': '{count}개 라운드',
        'trends.nodata': '스코어가 있는 라운드가 없습니다. 라운드를 동기화하면 트렌드를 확인할 수 있습니다.',
        'trends.coming': '곧 출시 예정',
        'trends.coming.desc': '스코어 트렌드, 클럽 성적, 스트로크 게인드 이력, 건강 데이터 추적을 모든 라운드에 걸쳐 확인할 수 있습니다.',
        'trends.scoring': '스코어 트렌드',
        'trends.best': '베스트',
        'trends.avgscore': '평균 스코어',
        'trends.avgoverpar': '평균 오버파',
        'trends.trend': '추세',
        'trends.overpar': '오버파',
        'trends.movingavg': '5회 이동평균',
        'trends.shortgame': '숏게임 & 퍼팅',
        'trends.puttsperhole': '퍼팅 / 홀',
        'trends.avggir': '평균 GIR',
        'trends.avgfir': '평균 FIR',
        'trends.putts': '퍼팅',
        'trends.fitness': '건강 & 체력',
        'trends.avghr': '평균 심박수',
        'trends.avgcal': '평균 칼로리',
        'trends.avgtempo': '평균 템포',
        'trends.hr': '심박수 (bpm)',
        'trends.calories': '칼로리',
        'trends.tempo': '템포',
        'trends.sg.title': '스트로크 게인드 트렌드',
        'trends.sg.avgtotal': '평균 총 SG',
        'trends.sg.strongest': '강점',
        'trends.sg.weakest': '약점',
        'trends.sg.nodata': 'SG 트렌드를 위한 라운드가 부족합니다.',
        'trends.club.title': '클럽 성적 (전체 라운드)',
        'trends.club.desc': '모든 라운드 합산. 이상치 샷(상크/레이업)은 평균 거리에서 제외.',
        'trends.club.avgdist': '평균 거리',
        'trends.club.excl': '제외',
        'trends.club.nodata': '클럽 트렌드를 위한 데이터가 부족합니다.',
        'trends.clubdetail.title': '클럽별 상세 트렌드',
        'trends.clubdetail.avgdev': '평균 편차 (°)',
        'trends.clubdetail.deviation': '편차 (°)',
        'trends.last': '최근',

        // Apple sync
        'sync.apple.notfound': '네트워크에서 아이폰을 찾을 수 없습니다',
        'sync.android.label': '안드로이드 동기화',
        'sync.android.syncing': '동기화 중...',
        'sync.android.notfound': '네트워크에서 안드로이드 폰을 찾을 수 없습니다. GoBirdie 설정에서 동기화 서버를 활성화하세요.',
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
    ko: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="30" height="20" style="border-radius:2px;box-shadow:0 0 1px rgba(0,0,0,0.3)">
      <rect width="30" height="20" fill="white"/>
      <!-- Taegeuk (yin-yang) -->
      <circle cx="15" cy="10" r="5" fill="#CD2E3A"/>
      <path d="M15,5 a2.5,2.5 0 0,1 0,5 a2.5,2.5 0 0,0 0,5 a5,5 0 0,1 0,-10z" fill="#0047A0"/>
      <circle cx="15" cy="7.5" r="1.25" fill="#CD2E3A"/>
      <circle cx="15" cy="12.5" r="1.25" fill="#0047A0"/>
      <!-- 건 (☰) top-left: 3 solid bars -->
      <g transform="translate(4.5,3.5) rotate(-45)">
        <rect x="-2.5" y="-2.2" width="5" height="1" fill="black"/>
        <rect x="-2.5" y="-0.5" width="5" height="1" fill="black"/>
        <rect x="-2.5" y="1.2" width="5" height="1" fill="black"/>
      </g>
      <!-- 곤 (☷) bottom-right: 3 broken bars -->
      <g transform="translate(25.5,16.5) rotate(-45)">
        <rect x="-2.5" y="-2.2" width="2" height="1" fill="black"/>
        <rect x="0.5" y="-2.2" width="2" height="1" fill="black"/>
        <rect x="-2.5" y="-0.5" width="2" height="1" fill="black"/>
        <rect x="0.5" y="-0.5" width="2" height="1" fill="black"/>
        <rect x="-2.5" y="1.2" width="2" height="1" fill="black"/>
        <rect x="0.5" y="1.2" width="2" height="1" fill="black"/>
      </g>
      <!-- 감 (☵) top-right: broken, solid, broken -->
      <g transform="translate(25.5,3.5) rotate(45)">
        <rect x="-2.5" y="-2.2" width="2" height="1" fill="black"/>
        <rect x="0.5" y="-2.2" width="2" height="1" fill="black"/>
        <rect x="-2.5" y="-0.5" width="5" height="1" fill="black"/>
        <rect x="-2.5" y="1.2" width="2" height="1" fill="black"/>
        <rect x="0.5" y="1.2" width="2" height="1" fill="black"/>
      </g>
      <!-- 리 (☲) bottom-left: solid, broken, solid -->
      <g transform="translate(4.5,16.5) rotate(45)">
        <rect x="-2.5" y="-2.2" width="5" height="1" fill="black"/>
        <rect x="-2.5" y="-0.5" width="2" height="1" fill="black"/>
        <rect x="0.5" y="-0.5" width="2" height="1" fill="black"/>
        <rect x="-2.5" y="1.2" width="5" height="1" fill="black"/>
      </g>
    </svg>`
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
