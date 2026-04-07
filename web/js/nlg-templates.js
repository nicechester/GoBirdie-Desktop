// ── NLG Template Library ─────────────────────────────────────────────────────
// Each template: { code, condition(d) → bool, severity, tier, messages: [(d) → string] }
// d = the analytics context object built by buildAnalyticsContext()
// severity: 'critical' | 'warning' | 'positive' | 'info'
// tier: 1 (most important) → 4 (minor/positive)
// pick(arr) selects a random variant for natural variety

import { getLang } from './i18n.js';

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : 0; }
function sgFmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }
function abs(v) { return Math.abs(v); }

// Helper: pick message from current language, fallback to 'en'
function msg(msgs) {
    const lang = getLang();
    const arr = msgs[lang] ?? msgs.en;
    return arr[Math.floor(Math.random() * arr.length)];
}

export const NLG_TEMPLATES = [

    // ── TIER 1: Critical SG weaknesses ───────────────────────────────────────

    {
        code: 'SG_PUTTING_CRITICAL',
        condition: d => d.sg.categories.putting < -1.5,
        severity: 'critical', tier: 1,
        messages: {
            en: [
                d => `Putting was the biggest hole in your scorecard today — you lost ${sgFmt(d.sg.categories.putting)} strokes on the greens. That's the single biggest area to address.`,
                d => `The putter cost you ${sgFmt(d.sg.categories.putting)} strokes today. Even recovering half of that would have saved ${abs(d.sg.categories.putting / 2).toFixed(1)} shots.`,
                d => `You gave away ${sgFmt(d.sg.categories.putting)} strokes putting — more than any other part of your game. Green reading and lag putting should be your practice priority.`,
                d => `${sgFmt(d.sg.categories.putting)} strokes lost putting. That's the difference between a good round and a great one. Speed control on long putts is the quickest fix.`,
            ],
            ko: [
                d => `오늘 퍼팅이 스코어카드의 가장 큰 약점이었습니다 — 그린에서 ${sgFmt(d.sg.categories.putting)} 타를 잃었습니다. 가장 먼저 개선해야 할 부분입니다.`,
                d => `퍼터가 오늘 ${sgFmt(d.sg.categories.putting)} 타를 잃게 했습니다. 절반만 회복해도 ${abs(d.sg.categories.putting / 2).toFixed(1)} 타를 줄일 수 있었습니다.`,
                d => `퍼팅에서 ${sgFmt(d.sg.categories.putting)} 타를 잃었습니다 — 게임의 어떤 부분보다 많습니다. 그린 리딩과 래그 퍼팅 연습이 우선입니다.`,
                d => `퍼팅에서 ${sgFmt(d.sg.categories.putting)} 타 손실. 롱 퍼트의 스피드 컨트롤이 가장 빠른 개선 방법입니다.`,
            ],
        }
    },
    {
        code: 'SG_APPROACH_CRITICAL',
        condition: d => d.sg.categories.approach < -1.5,
        severity: 'critical', tier: 1,
        messages: {
            en: [
                d => `Approach play was your Achilles heel today — ${sgFmt(d.sg.categories.approach)} strokes lost on shots into the green. Better iron proximity would have a huge scoring impact.`,
                d => `You lost ${sgFmt(d.sg.categories.approach)} strokes on approach shots. That's the equivalent of turning several pars into bogeys just from poor iron play.`,
                d => `Iron play cost you ${sgFmt(d.sg.categories.approach)} strokes today. Focus on distance control — getting the ball within 20 feet consistently is the goal.`,
                d => `${sgFmt(d.sg.categories.approach)} strokes lost on approach shots. Your irons weren't finding the center of the green. Dial in your yardages on the range.`,
            ],
            ko: [
                d => `오늘 어프로치 플레이가 가장 큰 약점이었습니다 — 그린 공략에서 ${sgFmt(d.sg.categories.approach)} 타 손실. 아이언 정확도를 높이면 스코어가 크게 개선됩니다.`,
                d => `어프로치 샷에서 ${sgFmt(d.sg.categories.approach)} 타를 잃었습니다. 부실한 아이언 플레이로 여러 파가 보기로 바뀐 것과 같습니다.`,
                d => `아이언 플레이가 오늘 ${sgFmt(d.sg.categories.approach)} 타를 소모했습니다. 거리 컨트롤에 집중하세요 — 꾸준히 20피트 이내로 볼을 보내는 것이 목표입니다.`,
                d => `어프로치에서 ${sgFmt(d.sg.categories.approach)} 타 손실. 아이언이 그린 중앙을 찾지 못했습니다. 레인지에서 거리를 맞춰보세요.`,
            ],
        }
    },
    {
        code: 'SG_OFF_TEE_CRITICAL',
        condition: d => d.sg.categories.off_tee < -1.5,
        severity: 'critical', tier: 1,
        messages: {
            en: [
                d => `Tee shots were a major problem today — ${sgFmt(d.sg.categories.off_tee)} strokes lost off the tee. Errant drives put you in recovery mode all round.`,
                d => `You lost ${sgFmt(d.sg.categories.off_tee)} strokes off the tee. Finding more fairways would immediately reduce your score.`,
                d => `The driver cost you ${sgFmt(d.sg.categories.off_tee)} strokes. Consider trading distance for accuracy — a shorter club off the tee on tight holes could save several shots.`,
                d => `${sgFmt(d.sg.categories.off_tee)} strokes lost off the tee. That's 2-3 shots just from poor driving. Tee it down and focus on the fairway.`,
            ],
            ko: [
                d => `오늘 티샷이 큰 문제였습니다 — 티에서 ${sgFmt(d.sg.categories.off_tee)} 타 손실. 빗나간 드라이브로 라운드 내내 회복 모드였습니다.`,
                d => `티에서 ${sgFmt(d.sg.categories.off_tee)} 타를 잃었습니다. 페어웨이를 더 많이 찾으면 스코어가 바로 줄어들 것입니다.`,
                d => `드라이버가 ${sgFmt(d.sg.categories.off_tee)} 타를 소모했습니다. 좋은 홀에서는 거리보다 정확도를 우선하는 것을 고려해보세요.`,
                d => `티에서 ${sgFmt(d.sg.categories.off_tee)} 타 손실. 부실한 드라이브만으로 2-3타를 잃었습니다. 페어웨이에 집중하세요.`,
            ],
        }
    },
    {
        code: 'SG_SHORT_GAME_CRITICAL',
        condition: d => d.sg.categories.short_game < -1.0,
        severity: 'critical', tier: 1,
        messages: {
            en: [
                d => `Your short game lost you ${sgFmt(d.sg.categories.short_game)} strokes today. Shots inside 50 yards are where scores are made or broken — this needs work.`,
                d => `The scoring zone (inside 50 yards) cost you ${sgFmt(d.sg.categories.short_game)} strokes. Chipping and pitching practice would have an outsized impact on your scores.`,
                d => `You lost ${sgFmt(d.sg.categories.short_game)} strokes around the green. Getting up-and-down more consistently is the fastest way to lower your score.`,
            ],
            ko: [
                d => `오늘 순게임에서 ${sgFmt(d.sg.categories.short_game)} 타를 잃었습니다. 50야드 이내 샷이 스코어를 좌우합니다 — 연습이 필요합니다.`,
                d => `스코어링 존(50야드 이내)에서 ${sgFmt(d.sg.categories.short_game)} 타 손실. 칩핑과 피칭 연습이 스코어에 큰 영향을 줄 것입니다.`,
                d => `그린 주변에서 ${sgFmt(d.sg.categories.short_game)} 타를 잃었습니다. 업앤다운 성공률을 높이는 것이 스코어를 줄이는 가장 빠른 방법입니다.`,
            ],
        }
    },

    // ── TIER 1: Strong SG positives ──────────────────────────────────────────

    {
        code: 'SG_PUTTING_STRONG',
        condition: d => d.sg.categories.putting > 1.0,
        severity: 'positive', tier: 1,
        messages: {
            en: [
                d => `The putter was on fire today — you gained ${sgFmt(d.sg.categories.putting)} strokes putting. That's elite-level performance on the greens.`,
                d => `Putting was your superpower today at ${sgFmt(d.sg.categories.putting)} strokes gained. Your green reading and pace control were excellent.`,
                d => `You gained ${sgFmt(d.sg.categories.putting)} strokes with the putter — a genuine strength that saved your scorecard today.`,
            ],
            ko: [
                d => `오늘 퍼터가 불을 뿜었습니다 — 퍼팅에서 ${sgFmt(d.sg.categories.putting)} 타를 벌었습니다. 엘리트 수준의 그린 퍼포먼스입니다.`,
                d => `오늘 퍼팅이 최고의 무기였습니다 — ${sgFmt(d.sg.categories.putting)} 타 획득. 그린 리딩과 페이스 컨트롤이 훌륭했습니다.`,
                d => `퍼터로 ${sgFmt(d.sg.categories.putting)} 타를 벌었습니다 — 오늘 스코어카드를 살린 진정한 강점입니다.`,
            ],
        }
    },
    {
        code: 'SG_APPROACH_STRONG',
        condition: d => d.sg.categories.approach > 1.0,
        severity: 'positive', tier: 1,
        messages: {
            en: [
                d => `Ball striking was excellent today — ${sgFmt(d.sg.categories.approach)} strokes gained on approach shots. You were hitting it close consistently.`,
                d => `Your iron play gained you ${sgFmt(d.sg.categories.approach)} strokes today. That kind of approach play gives you birdie looks and takes pressure off the putter.`,
                d => `${sgFmt(d.sg.categories.approach)} strokes gained on approach — your irons were the standout part of your game today.`,
            ],
            ko: [
                d => `오늘 볼 스트라이킹이 훌륭했습니다 — 어프로치에서 ${sgFmt(d.sg.categories.approach)} 타 획득. 꾸준히 핀 가까이 붙였습니다.`,
                d => `아이언 플레이로 ${sgFmt(d.sg.categories.approach)} 타를 벌었습니다. 이런 어프로치는 버디 기회를 만들고 퍼터 부담을 줄여줍니다.`,
                d => `어프로치에서 ${sgFmt(d.sg.categories.approach)} 타 획득 — 오늘 게임에서 아이언이 가장 돋보였습니다.`,
            ],
        }
    },
    {
        code: 'SG_TOTAL_POSITIVE',
        condition: d => d.sg.total > 2.0,
        severity: 'positive', tier: 1,
        messages: {
            en: [
                d => `Overall you gained ${sgFmt(d.sg.total)} strokes against the single-digit baseline today — a genuinely strong performance across the board.`,
                d => `${sgFmt(d.sg.total)} total strokes gained is an impressive round. You outperformed the single-digit benchmark in multiple areas.`,
                d => `You gained ${sgFmt(d.sg.total)} strokes today — a dominant all-around performance. This is the kind of round that builds confidence.`,
            ],
            ko: [
                d => `오늘 싱글 핸디캡 기준 대비 총 ${sgFmt(d.sg.total)} 타를 벌었습니다 — 전반적으로 정말 강한 퍼포먼스입니다.`,
                d => `총 ${sgFmt(d.sg.total)} 타 획득은 인상적인 라운드입니다. 여러 영역에서 싱글 핸디캡 기준을 능가했습니다.`,
                d => `오늘 ${sgFmt(d.sg.total)} 타를 벌었습니다 — 압도적인 올라운드 퍼포먼스. 자신감을 키워주는 라운드입니다.`,
            ],
        }
    },

    // ── TIER 2: Correlations ─────────────────────────────────────────────────

    {
        code: 'HIGH_FIR_LOW_GIR',
        condition: d => d.fir >= 55 && d.girPct < 35,
        severity: 'critical', tier: 2,
        messages: {
            en: [
                d => `You hit ${d.fir}% of fairways but only ${d.girPct}% of greens — your driving is setting you up well but the irons aren't converting. Distance control on approach shots is the gap.`,
                d => `Great driving (${d.fir}% FIR) but only ${d.girPct}% GIR tells a clear story: the iron play isn't capitalizing on good tee shots.`,
            ],
            ko: [
                d => `페어웨이 ${d.fir}% 안착했지만 그린은 ${d.girPct}%만 적중 — 드라이브는 좋지만 아이언이 살리지 못하고 있습니다. 어프로치 거리 컨트롤이 문제입니다.`,
                d => `훌륭한 드라이브(${d.fir}% FIR)에 비해 ${d.girPct}% GIR은 명확한 이야기를 해줍니다: 아이언이 좋은 티샷을 살리지 못하고 있습니다.`,
            ],
        }
    },
    {
        code: 'LOW_FIR_HIGH_GIR',
        condition: d => d.fir < 35 && d.girPct >= 50,
        severity: 'info', tier: 2,
        messages: {
            en: [
                d => `Interesting pattern — only ${d.fir}% fairways hit but ${d.girPct}% GIR. Your iron play is bailing out your driving. Imagine the scoring potential if you combined both.`,
                d => `You're hitting ${d.girPct}% of greens despite only ${d.fir}% fairways — impressive recovery iron play. Cleaning up the tee shots would make you even more dangerous.`,
            ],
            ko: [
                d => `흥미로운 패턴 — 페어웨이 ${d.fir}%지만 GIR ${d.girPct}%. 아이언이 드라이브를 보완하고 있습니다. 둘 다 합치면 스코어링 잠재력이 엄청날 것입니다.`,
                d => `페어웨이 ${d.fir}%에도 불구하고 GIR ${d.girPct}% — 인상적인 회복 아이언 플레이. 티샷만 개선하면 더 강해질 것입니다.`,
            ],
        }
    },
    {
        code: 'THREE_PUTTS',
        condition: d => d.threePutts >= 2,
        severity: 'critical', tier: 2,
        messages: {
            en: [
                d => `${d.threePutts} three-putts today — each one is a direct stroke wasted. Lag putting from long range is costing you. Focus on getting the first putt within 3 feet.`,
                d => `You three-putted ${d.threePutts} times. That alone accounts for ${d.threePutts} extra strokes. Distance control on long putts should be your putting practice focus.`,
            ],
            ko: [
                d => `오늘 ${d.threePutts}번의 3퍼팅 — 각각이 직접적인 타수 낭비입니다. 롱 레인지 래그 퍼팅이 문제입니다. 첫 퍼트를 3피트 이내로 보내는 데 집중하세요.`,
                d => `${d.threePutts}번 3퍼팅했습니다. 그것만으로 ${d.threePutts}타 추가. 롱 퍼트 거리 컨트롤이 퍼팅 연습의 핵심이 되어야 합니다.`,
            ],
        }
    },
    {
        code: 'GOOD_SCRAMBLING',
        condition: d => d.scramblingPct >= 50 && d.girPct < 45,
        severity: 'positive', tier: 2,
        messages: {
            en: [
                d => `You only hit ${d.girPct}% of greens but scrambled well — your short game saved several shots today. That fighting spirit kept the score respectable.`,
                d => `${d.scramblingPct}% scrambling despite ${d.girPct}% GIR is impressive. You're a tough competitor who doesn't give up on holes.`,
            ],
            ko: [
                d => `GIR ${d.girPct}%지만 스크램블링을 잘 했습니다 — 순게임이 여러 타를 살렸습니다. 투지가 스코어를 지켰습니다.`,
                d => `GIR ${d.girPct}%에도 스크램블링 ${d.scramblingPct}%는 인상적입니다. 홀을 포기하지 않는 강인한 경쟁자입니다.`,
            ],
        }
    },
    {
        code: 'POOR_SCRAMBLING',
        condition: d => d.scramblingPct < 25 && d.girPct < 45,
        severity: 'critical', tier: 2,
        messages: {
            en: [
                d => `You missed ${100 - d.girPct}% of greens and only scrambled ${d.scramblingPct}% of the time — a double whammy. Short game needs significant work.`,
                d => `${d.scramblingPct}% scrambling is brutal. You're not recovering from missed greens. This is costing you 4-5 shots per round.`,
            ],
            ko: [
                d => `그린 ${100 - d.girPct}% 미스에 스크램블링 ${d.scramblingPct}% — 이중고. 순게임에 상당한 연습이 필요합니다.`,
                d => `스크램블링 ${d.scramblingPct}%는 심각합니다. 미스된 그린에서 회복하지 못하고 있습니다. 라운드당 4-5타 손실입니다.`,
            ],
        }
    },
    {
        code: 'HIGH_STRESS_POOR_SG',
        condition: d => d.avgStress > 55 && d.sg.total < -1.0,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `Your average stress was ${d.avgStress} today and your SG was ${sgFmt(d.sg.total)} — high stress and poor performance often go hand in hand. Pre-shot routine and course management may help.`,
                d => `Elevated stress (avg ${d.avgStress}) combined with ${sgFmt(d.sg.total)} strokes gained suggests mental pressure may be affecting your swing.`,
            ],
            ko: [
                d => `평균 스트레스 ${d.avgStress}, SG ${sgFmt(d.sg.total)} — 높은 스트레스와 저조한 퍼포먼스는 함께 갑니다. 프리샷 루틴과 코스 매니지먼트가 도움이 될 수 있습니다.`,
                d => `높은 스트레스(평균 ${d.avgStress})와 ${sgFmt(d.sg.total)} SG는 정신적 압박이 스윙에 영향을 주고 있을 수 있음을 시사합니다.`,
            ],
        }
    },
    {
        code: 'HIGH_HR_LATE_ROUND',
        condition: d => d.lateRoundHr > d.earlyRoundHr + 8,
        severity: 'info', tier: 2,
        messages: {
            en: [
                d => `Your heart rate climbed ${Math.round(d.lateRoundHr - d.earlyRoundHr)} bpm from the front to back nine — fatigue or pressure may have been a factor in the later holes.`,
                d => `HR was notably higher on the back nine (${Math.round(d.lateRoundHr)} vs ${Math.round(d.earlyRoundHr)} bpm). Physical conditioning or managing pressure late in rounds could be worth working on.`,
            ],
            ko: [
                d => `심박수가 전반에서 후반으로 ${Math.round(d.lateRoundHr - d.earlyRoundHr)} bpm 상승 — 피로나 압박이 후반 홀에 영향을 줬을 수 있습니다.`,
                d => `후반 심박수(${Math.round(d.lateRoundHr)} bpm)가 전반(${Math.round(d.earlyRoundHr)} bpm)보다 눈에 띄게 높았습니다. 체력 관리가 필요할 수 있습니다.`,
            ],
        }
    },
    {
        code: 'BODY_BATTERY_LOW',
        condition: d => d.bbEnd != null && d.bbEnd < 20,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `Your Body Battery finished at ${d.bbEnd}% — you were running on empty by the end. Recovery before your next round is important.`,
                d => `Ending the round at ${d.bbEnd}% Body Battery suggests significant physical exertion. Sleep and recovery quality will affect your next performance.`,
            ],
            ko: [
                d => `바디 배터리가 ${d.bbEnd}%로 끝났습니다 — 마지막에는 완전히 방전된 상태였습니다. 다음 라운드 전 회복이 중요합니다.`,
                d => `바디 배터리 ${d.bbEnd}%로 마무리는 상당한 체력 소모를 의미합니다. 수면과 회복이 다음 퍼포먼스에 영향을 줄 것입니다.`,
            ],
        }
    },
    {
        code: 'BODY_BATTERY_DRAIN_HIGH',
        condition: d => d.bbDrain != null && d.bbDrain > 40,
        severity: 'info', tier: 2,
        messages: {
            en: [
                d => `You drained ${d.bbDrain}% Body Battery today — a demanding round physically. Make sure to prioritize recovery.`,
                d => `A ${d.bbDrain}% Body Battery drain is significant. Golf is more physically demanding than it looks, especially walking a full round.`,
            ],
            ko: [
                d => `오늘 바디 배터리 ${d.bbDrain}% 소모 — 체력적으로 힘든 라운드였습니다. 회복을 우선하세요.`,
                d => `바디 배터리 ${d.bbDrain}% 소모는 상당합니다. 걸어서 라운딩하면 골프는 생각보다 체력 소모가 큽니다.`,
            ],
        }
    },
    {
        code: 'FRONT_BACK_SPLIT_WORSE',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.backNineScore > d.frontNineScore + 4,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `You scored ${d.frontNineScore} on the front but ${d.backNineScore} on the back — a ${d.backNineScore - d.frontNineScore} shot drop-off. Fatigue or concentration may be fading late in rounds.`,
                d => `Front nine: ${d.frontNineScore}, back nine: ${d.backNineScore}. That's a significant fade. Consider your energy management for the second half.`,
            ],
            ko: [
                d => `전반 ${d.frontNineScore}타, 후반 ${d.backNineScore}타 — ${d.backNineScore - d.frontNineScore}타 하락. 피로나 집중력이 후반에 떨어지고 있을 수 있습니다.`,
                d => `전반: ${d.frontNineScore}, 후반: ${d.backNineScore}. 상당한 하락세입니다. 후반을 위한 에너지 관리를 고려해보세요.`,
            ],
        }
    },
    {
        code: 'FRONT_BACK_SPLIT_BETTER',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.frontNineScore > d.backNineScore + 3,
        severity: 'positive', tier: 2,
        messages: {
            en: [
                d => `Strong finish — you improved ${d.frontNineScore - d.backNineScore} shots from front (${d.frontNineScore}) to back (${d.backNineScore}). You play better when warmed up.`,
                d => `Back nine (${d.backNineScore}) was much better than the front (${d.frontNineScore}). You clearly found your rhythm as the round progressed.`,
            ],
            ko: [
                d => `강한 마무리 — 전반(${d.frontNineScore})에서 후반(${d.backNineScore})으로 ${d.frontNineScore - d.backNineScore}타 개선. 몸이 풀리면 더 잘 치는 타입입니다.`,
                d => `후반(${d.backNineScore})이 전반(${d.frontNineScore})보다 훨씬 좋았습니다. 라운드가 진행되면서 리듬을 찾았습니다.`,
            ],
        }
    },
    {
        code: 'PAR3_STRUGGLES',
        condition: d => d.par3AvgOverPar > 0.8,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `Par 3s averaged +${d.par3AvgOverPar.toFixed(1)} over par today — tee shots on short holes are costing you. Iron accuracy from the tee needs attention.`,
                d => `You struggled on par 3s (avg +${d.par3AvgOverPar.toFixed(1)}). These holes should be birdie or par opportunities — focus on hitting the green from the tee.`,
            ],
            ko: [
                d => `파3 홀 평균 +${d.par3AvgOverPar.toFixed(1)} — 짧은 홀의 티샷이 스코어를 까먹고 있습니다. 티에서의 아이언 정확도에 신경 쓰세요.`,
                d => `파3에서 고전했습니다 (평균 +${d.par3AvgOverPar.toFixed(1)}). 이 홀들은 버디나 파 기회여야 합니다 — 티에서 그린 적중에 집중하세요.`,
            ],
        }
    },
    {
        code: 'PAR5_SCORING',
        condition: d => d.par5AvgOverPar > 0.5,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `Par 5s averaged +${d.par5AvgOverPar.toFixed(1)} today — these scoring holes aren't yielding birdies. Layup strategy and short game on par 5s could unlock lower scores.`,
                d => `You're not taking advantage of par 5s (avg +${d.par5AvgOverPar.toFixed(1)}). Better course management could save strokes here.`,
            ],
            ko: [
                d => `파5 홀 평균 +${d.par5AvgOverPar.toFixed(1)} — 스코어링 홀에서 버디를 만들지 못하고 있습니다. 레이업 전략과 순게임을 개선하면 스코어가 낮아질 것입니다.`,
                d => `파5를 활용하지 못하고 있습니다 (평균 +${d.par5AvgOverPar.toFixed(1)}). 더 나은 코스 매니지먼트가 타수를 줄일 수 있습니다.`,
            ],
        }
    },
    {
        code: 'PAR5_BIRDIE_MACHINE',
        condition: d => d.par5AvgOverPar < -0.3,
        severity: 'positive', tier: 2,
        messages: {
            en: [
                d => `Par 5s are your scoring holes — averaging ${d.par5AvgOverPar.toFixed(1)} today. Your length and course management on these holes is a real strength.`,
                d => `You're eating up par 5s (avg ${d.par5AvgOverPar.toFixed(1)}). That's where your game is most dangerous.`,
            ],
            ko: [
                d => `파5가 스코어링 홀입니다 — 평균 ${d.par5AvgOverPar.toFixed(1)}. 이 홀들에서의 비거리와 코스 매니지먼트가 진정한 강점입니다.`,
                d => `파5를 잠식하고 있습니다 (평균 ${d.par5AvgOverPar.toFixed(1)}). 게임이 가장 위험한 구간입니다.`,
            ],
        }
    },
    {
        code: 'CONSECUTIVE_BOGEYS',
        condition: d => d.maxConsecutiveBogeys >= 3,
        severity: 'warning', tier: 2,
        messages: {
            en: [
                d => `You had a run of ${d.maxConsecutiveBogeys} consecutive bogeys — momentum killers like this often come from one bad shot snowballing. Damage limitation and reset routines are key.`,
                d => `${d.maxConsecutiveBogeys} bogeys in a row at some point today. Breaking bad streaks early is a crucial mental skill.`,
            ],
            ko: [
                d => `${d.maxConsecutiveBogeys}개 연속 보기 — 이런 모멘텀 킬러는 하나의 나쁜 샷이 눈덩이처럼 커지는 경우가 많습니다. 데미지 제한과 리셋 루틴이 핵심입니다.`,
                d => `오늘 ${d.maxConsecutiveBogeys}개 연속 보기. 나쁜 흐름을 일찍 끊는 것이 중요한 멘탈 스킬입니다.`,
            ],
        }
    },

    // ── TIER 3: Club-specific ─────────────────────────────────────────────────

    {
        code: 'WORST_CLUB_SG',
        condition: d => d.worstClub != null && d.worstClub.avgSg < -0.3,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your ${d.worstClub.name} was your weakest club today (avg SG ${sgFmt(d.worstClub.avgSg)} over ${d.worstClub.shots} shots). Consider whether club selection or technique is the issue.`,
                d => `The ${d.worstClub.name} cost you the most strokes per shot (${sgFmt(d.worstClub.avgSg)} avg SG). Targeted practice with this club would pay dividends.`,
            ],
            ko: [
                d => `${d.worstClub.name}이(가) 오늘 가장 약한 클럽이었습니다 (평균 SG ${sgFmt(d.worstClub.avgSg)}, ${d.worstClub.shots}샷). 클럽 선택이나 기술이 문제인지 고려해보세요.`,
                d => `${d.worstClub.name}이(가) 샷당 가장 많은 타수를 소모했습니다 (${sgFmt(d.worstClub.avgSg)} 평균 SG). 이 클럽 집중 연습이 효과적일 것입니다.`,
            ],
        }
    },
    {
        code: 'BEST_CLUB_SG',
        condition: d => d.bestClub != null && d.bestClub.avgSg > 0.2,
        severity: 'positive', tier: 3,
        messages: {
            en: [
                d => `Your ${d.bestClub.name} was your best club today — ${sgFmt(d.bestClub.avgSg)} avg SG over ${d.bestClub.shots} shots. Lean on it when you need a reliable shot.`,
                d => `The ${d.bestClub.name} was dialed in today (${sgFmt(d.bestClub.avgSg)} avg SG). That's a club you can trust under pressure.`,
            ],
            ko: [
                d => `${d.bestClub.name}이(가) 오늘 최고의 클럽이었습니다 — ${d.bestClub.shots}샷에서 평균 SG ${sgFmt(d.bestClub.avgSg)}. 안정적인 샷이 필요할 때 의지하세요.`,
                d => `${d.bestClub.name}이(가) 오늘 완벽했습니다 (${sgFmt(d.bestClub.avgSg)} 평균 SG). 압박 상황에서 믿을 수 있는 클럽입니다.`,
            ],
        }
    },
    {
        code: 'DRIVER_INCONSISTENT',
        condition: d => d.driverClub != null && d.driverClub.distStd > 30,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your Driver had high distance variance (±${Math.round(d.driverClub.distStd)} yds) — a more controlled, repeatable swing may trade a little distance for a lot more consistency.`,
                d => `Driver distance was all over the place today (±${Math.round(d.driverClub.distStd)} yds std dev). Focus on center contact over maximum distance.`,
            ],
            ko: [
                d => `드라이버 거리 편차가 컴니다 (±${Math.round(d.driverClub.distStd)}야드) — 더 컨트롤된 반복 가능한 스윙이 일관성을 높일 것입니다.`,
                d => `오늘 드라이버 거리가 들쫓날쫓했습니다 (±${Math.round(d.driverClub.distStd)}야드). 최대 거리보다 정타에 집중하세요.`,
            ],
        }
    },
    {
        code: 'DRIVER_RIGHT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev > 12,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your Driver has a consistent right bias (+${Math.round(d.driverClub.avgDev)}° avg) — a push or push-fade pattern. Check your alignment and club face at impact.`,
                d => `Tee shots are trending right (+${Math.round(d.driverClub.avgDev)}° avg deviation). Worth checking alignment on the range.`,
            ],
            ko: [
                d => `드라이버가 일관되게 우측으로 편향됩니다 (+${Math.round(d.driverClub.avgDev)}° 평균) — 푸시 또는 푸시페이드 패턴. 얼라인먼트와 임팩트 시 클럽페이스를 확인하세요.`,
                d => `티샷이 우측으로 향하고 있습니다 (+${Math.round(d.driverClub.avgDev)}° 평균 편차). 레인지에서 얼라인먼트를 확인해보세요.`,
            ],
        }
    },
    {
        code: 'DRIVER_LEFT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev < -12,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your Driver is pulling left (${Math.round(d.driverClub.avgDev)}° avg) — a hook or pull pattern. Check your grip pressure and swing path.`,
                d => `Tee shots are consistently left (${Math.round(d.driverClub.avgDev)}° avg deviation). A closed face or in-to-out path is likely the cause.`,
            ],
            ko: [
                d => `드라이버가 좌측으로 끌립니다 (${Math.round(d.driverClub.avgDev)}° 평균) — 훅 또는 풀 패턴. 그립 압력과 스윙 경로를 확인하세요.`,
                d => `티샷이 일관되게 좌측입니다 (${Math.round(d.driverClub.avgDev)}° 평균). 닫힌 페이스나 인투아웃 경로가 원인일 가능성이 높습니다.`,
            ],
        }
    },
    {
        code: 'IRONS_RIGHT_BIAS',
        condition: d => d.ironBias > 15,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your irons have a consistent right bias (+${Math.round(d.ironBias)}° avg) — a push or fade pattern. This is likely a systematic swing issue worth addressing on the range.`,
            ],
            ko: [
                d => `아이언이 일관되게 우측 편향입니다 (+${Math.round(d.ironBias)}° 평균) — 푸시 또는 페이드 패턴. 레인지에서 해결해야 할 체계적인 스윙 문제입니다.`,
            ],
        }
    },
    {
        code: 'IRONS_LEFT_BIAS',
        condition: d => d.ironBias < -15,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Your irons are pulling left (${Math.round(d.ironBias)}° avg) — a pull or draw pattern. Check your takeaway and ensure you're not coming over the top.`,
            ],
            ko: [
                d => `아이언이 좌측으로 끌립니다 (${Math.round(d.ironBias)}° 평균) — 풀 또는 드로우 패턴. 테이크어웨이를 확인하고 오버더탑이 아닌지 점검하세요.`,
            ],
        }
    },
    {
        code: 'WEDGE_INCONSISTENT',
        condition: d => d.wedgeClub != null && d.wedgeClub.distStd > 15,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `Wedge distances were inconsistent today (±${Math.round(d.wedgeClub.distStd)} yds). Dialing in your wedge yardages is one of the highest-ROI things you can do.`,
            ],
            ko: [
                d => `오늘 웨지 거리가 일관성이 없었습니다 (±${Math.round(d.wedgeClub.distStd)}야드). 웨지 거리를 정확히 맞추는 것이 가장 효과적인 연습입니다.`,
            ],
        }
    },
    {
        code: 'WEDGE_STRONG',
        condition: d => d.wedgeClub != null && d.wedgeClub.avgSg > 0.15,
        severity: 'positive', tier: 3,
        messages: {
            en: [
                d => `Wedge play was a strength today — ${sgFmt(d.wedgeClub.avgSg)} avg SG. Your distance control inside 100 yards is giving you birdie looks.`,
            ],
            ko: [
                d => `오늘 웨지 플레이가 강점이었습니다 — 평균 SG ${sgFmt(d.wedgeClub.avgSg)}. 100야드 이내 거리 컨트롤이 버디 기회를 만들고 있습니다.`,
            ],
        }
    },

    // ── TIER 3: Dispersion patterns ───────────────────────────────────────────

    {
        code: 'APPROACH_SHORT_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.shortPct > 55,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `You're leaving approach shots short ${d.approachDispersion.shortPct}% of the time from ${d.approachDispersion.label}. Club up — most amateur golfers consistently underclub.`,
            ],
            ko: [
                d => `${d.approachDispersion.label}에서 어프로치 샷이 ${d.approachDispersion.shortPct}% 짧습니다. 클럽을 올리세요 — 대부분의 아마추어 골퍼는 일관되게 클럽을 적게 잡습니다.`,
            ],
        }
    },
    {
        code: 'APPROACH_LONG_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.longPct > 45,
        severity: 'warning', tier: 3,
        messages: {
            en: [
                d => `You're flying approach shots long ${d.approachDispersion.longPct}% of the time from ${d.approachDispersion.label}. Check your yardages — adrenaline or wind may be adding distance.`,
            ],
            ko: [
                d => `${d.approachDispersion.label}에서 어프로치 샷이 ${d.approachDispersion.longPct}% 길습니다. 거리를 확인하세요 — 아드레날린이나 바람이 거리를 늘리고 있을 수 있습니다.`,
            ],
        }
    },
    {
        code: 'DISPERSION_TIGHT',
        condition: d => d.overallDispersionAngle < 12 && d.sg.catCounts.approach >= 4,
        severity: 'positive', tier: 3,
        messages: {
            en: [
                d => `Your shot dispersion was tight today (avg ${Math.round(d.overallDispersionAngle)}° deviation) — a sign of a repeatable swing.`,
            ],
            ko: [
                d => `오늘 샷 분산도가 좋았습니다 (평균 ${Math.round(d.overallDispersionAngle)}° 편차) — 반복 가능한 스윙의 징표입니다.`,
            ],
        }
    },

    // ── TIER 4: Minor observations & positives ────────────────────────────────

    {
        code: 'ONE_PUTTS_HIGH',
        condition: d => d.onePutts >= 4,
        severity: 'positive', tier: 4,
        messages: {
            en: [
                d => `${d.onePutts} one-putts today — you were holing out from close range consistently. That's a real scoring asset.`,
            ],
            ko: [
                d => `오늘 ${d.onePutts}번의 원퍼팅 — 근거리에서 꾸준히 넣었습니다. 진정한 스코어링 자산입니다.`,
            ],
        }
    },
    {
        code: 'PUTTING_DISTANCE_CONTROL',
        condition: d => d.threePutts === 0 && d.sc?.total_putts <= d.sc?.hole_scores?.length * 1.8,
        severity: 'positive', tier: 4,
        messages: {
            en: [
                d => `Zero three-putts today — your lag putting distance control was excellent. That's a sign of good green reading and pace judgment.`,
            ],
            ko: [
                d => `오늘 3퍼팅 제로 — 래그 퍼팅 거리 컨트롤이 훌륭했습니다. 좋은 그린 리딩과 페이스 판단의 징표입니다.`,
            ],
        }
    },
    {
        code: 'DISTANCE_WALKED',
        condition: d => d.distanceKm > 8,
        severity: 'info', tier: 4,
        messages: {
            en: [
                d => `You walked ${d.distanceKm.toFixed(1)} km today — golf is more of a workout than people give it credit for. Good physical conditioning helps maintain focus late in rounds.`,
            ],
            ko: [
                d => `오늘 ${d.distanceKm.toFixed(1)} km 걸었습니다 — 골프는 생각보다 운동량이 많습니다. 좋은 체력이 후반 집중력 유지에 도움이 됩니다.`,
            ],
        }
    },
    {
        code: 'ALTITUDE_RANGE',
        condition: d => d.altRange > 30,
        severity: 'info', tier: 4,
        messages: {
            en: [
                d => `The course had ${Math.round(d.altRange)}m of elevation change today. Remember that altitude affects ball flight — uphill shots play longer, downhill shots play shorter.`,
            ],
            ko: [
                d => `오늘 코스의 고도 변화가 ${Math.round(d.altRange)}m였습니다. 고도가 볼 비행에 영향을 준다는 것을 기억하세요 — 오르막은 더 길게, 내리막은 더 짧게 칩니다.`,
            ],
        }
    },
    {
        code: 'SWING_TEMPO_FAST',
        condition: d => d.avgTempo != null && d.avgTempo < 2.5,
        severity: 'warning', tier: 4,
        messages: {
            en: [
                d => `Your avg swing tempo was ${d.avgTempo.toFixed(1)}:1 today — on the fast side. A slightly longer backswing pause often leads to better sequencing and more consistent contact.`,
            ],
            ko: [
                d => `평균 스윙 템포가 ${d.avgTempo.toFixed(1)}:1로 빠른 편입니다. 백스윙 정점에서 약간 더 멈추면 시퀀싱과 일관성이 개선될 수 있습니다.`,
            ],
        }
    },
    {
        code: 'SWING_TEMPO_GOOD',
        condition: d => d.avgTempo != null && d.avgTempo >= 2.8 && d.avgTempo <= 3.5,
        severity: 'positive', tier: 4,
        messages: {
            en: [
                d => `Your swing tempo (${d.avgTempo.toFixed(1)}:1) is in the ideal range. Good tempo is the foundation of consistent ball striking.`,
            ],
            ko: [
                d => `스윙 템포(${d.avgTempo.toFixed(1)}:1)가 이상적인 범위에 있습니다. 좋은 템포는 일관된 볼 스트라이킹의 기초입니다.`,
            ],
        }
    },
    {
        code: 'ROUND_DURATION_LONG',
        condition: d => d.durationMin > 270,
        severity: 'info', tier: 4,
        messages: {
            en: [
                d => `The round took ${Math.round(d.durationMin)} minutes — a long day out. Mental fatigue over 4+ hours can affect decision-making and focus on the back nine.`,
            ],
            ko: [
                d => `라운드가 ${Math.round(d.durationMin)}분 걸렸습니다 — 긴 하루였습니다. 4시간 이상의 정신적 피로는 후반 판단력과 집중력에 영향을 줄 수 있습니다.`,
            ],
        }
    },
    {
        code: 'SG_BALANCED',
        condition: d => Object.values(d.sg.categories).every(v => Math.abs(v) < 0.5),
        severity: 'info', tier: 4,
        messages: {
            en: [
                d => `Your strokes gained were balanced across all categories today — no single area was a disaster or a standout. Consistent all-round play is a solid foundation.`,
            ],
            ko: [
                d => `오늘 스트로크 게인드가 모든 카테고리에서 균형 잡혀 있었습니다 — 특별히 나쁜 부분도 돋보이는 부분도 없었습니다. 일관된 올라운드 플레이는 튼튼한 기반입니다.`,
            ],
        }
    },
];

