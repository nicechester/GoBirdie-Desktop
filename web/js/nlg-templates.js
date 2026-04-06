// ── NLG Template Library ─────────────────────────────────────────────────────
// Each template: { code, condition(d) → bool, severity, tier, messages: [(d) → string] }
// d = the analytics context object built by buildAnalyticsContext()
// severity: 'critical' | 'warning' | 'positive' | 'info'
// tier: 1 (most important) → 4 (minor/positive)
// pick(arr) selects a random variant for natural variety

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : 0; }
function sgFmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }
function abs(v) { return Math.abs(v); }

export const NLG_TEMPLATES = [

    // ── TIER 1: Critical SG weaknesses ───────────────────────────────────────

    {
        code: 'SG_PUTTING_CRITICAL',
        condition: d => d.sg.categories.putting < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Putting was the biggest hole in your scorecard today — you lost ${sgFmt(d.sg.categories.putting)} strokes on the greens. That's the single biggest area to address.`,
            d => `The putter cost you ${sgFmt(d.sg.categories.putting)} strokes today. Even recovering half of that would have saved ${abs(d.sg.categories.putting / 2).toFixed(1)} shots.`,
            d => `You gave away ${sgFmt(d.sg.categories.putting)} strokes putting — more than any other part of your game. Green reading and lag putting should be your practice priority.`,
            d => `${sgFmt(d.sg.categories.putting)} strokes lost putting. That's the difference between a good round and a great one. Speed control on long putts is the quickest fix.`,
            d => `Putting was brutal today at ${sgFmt(d.sg.categories.putting)} strokes gained. Your scorecard would look completely different with average putting performance.`,
            d => `The greens were unkind — ${sgFmt(d.sg.categories.putting)} strokes lost putting. Focus on reading break and committing to your line rather than second-guessing.`,
            d => `You left ${sgFmt(d.sg.categories.putting)} strokes on the greens today. That's a full 2-3 shots just from putting. This is where your biggest improvement opportunity lies.`,
        ]
    },
    {
        code: 'SG_APPROACH_CRITICAL',
        condition: d => d.sg.categories.approach < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Approach play was your Achilles heel today — ${sgFmt(d.sg.categories.approach)} strokes lost on shots into the green. Better iron proximity would have a huge scoring impact.`,
            d => `You lost ${sgFmt(d.sg.categories.approach)} strokes on approach shots. That's the equivalent of turning several pars into bogeys just from poor iron play.`,
            d => `Iron play cost you ${sgFmt(d.sg.categories.approach)} strokes today. Focus on distance control — getting the ball within 20 feet consistently is the goal.`,
            d => `${sgFmt(d.sg.categories.approach)} strokes lost on approach shots. Your irons weren't finding the center of the green. Dial in your yardages on the range.`,
            d => `Approach shots were a major leak at ${sgFmt(d.sg.categories.approach)} strokes gained. You're leaving yourself too far from the hole for birdie looks.`,
            d => `Iron play was off today — ${sgFmt(d.sg.categories.approach)} strokes lost. Check your ball position and ensure you're hitting your clubs the distances you think you are.`,
            d => `${sgFmt(d.sg.categories.approach)} strokes lost approaching the green. That's costing you 2-3 shots per round. This is where focused practice pays immediate dividends.`,
        ]
    },
    {
        code: 'SG_OFF_TEE_CRITICAL',
        condition: d => d.sg.categories.off_tee < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Tee shots were a major problem today — ${sgFmt(d.sg.categories.off_tee)} strokes lost off the tee. Errant drives put you in recovery mode all round.`,
            d => `You lost ${sgFmt(d.sg.categories.off_tee)} strokes off the tee. Finding more fairways would immediately reduce your score by taking difficult recovery shots out of the equation.`,
            d => `The driver cost you ${sgFmt(d.sg.categories.off_tee)} strokes. Consider trading distance for accuracy — a shorter club off the tee on tight holes could save several shots.`,
            d => `Off-the-tee play was a disaster at ${sgFmt(d.sg.categories.off_tee)} strokes gained. You spent the whole round in the rough or trees. Accuracy beats distance every time.`,
            d => `${sgFmt(d.sg.categories.off_tee)} strokes lost off the tee. That's 2-3 shots just from poor driving. Tee it down and focus on the fairway, not the back fence.`,
            d => `Driving was your biggest problem today — ${sgFmt(d.sg.categories.off_tee)} strokes lost. One solid range session on accuracy could transform your scoring.`,
            d => `Tee shots cost you ${sgFmt(d.sg.categories.off_tee)} strokes. You're starting holes in bad positions. Better course management off the tee is your quickest path to lower scores.`,
        ]
    },
    {
        code: 'SG_SHORT_GAME_CRITICAL',
        condition: d => d.sg.categories.short_game < -1.0,
        severity: 'critical', tier: 1,
        messages: [
            d => `Your short game lost you ${sgFmt(d.sg.categories.short_game)} strokes today. Shots inside 50 yards are where scores are made or broken — this needs work.`,
            d => `The scoring zone (inside 50 yards) cost you ${sgFmt(d.sg.categories.short_game)} strokes. Chipping and pitching practice would have an outsized impact on your scores.`,
            d => `You lost ${sgFmt(d.sg.categories.short_game)} strokes around the green. Getting up-and-down more consistently from short range is the fastest way to lower your score.`,
            d => `Short game was a liability at ${sgFmt(d.sg.categories.short_game)} strokes gained. You're not capitalizing on chances to save par. Spend time on chipping and pitching.`,
            d => `${sgFmt(d.sg.categories.short_game)} strokes lost inside 50 yards. That's where the game is won or lost. Your practice time should reflect this priority.`,
            d => `Scoring zone performance was poor — ${sgFmt(d.sg.categories.short_game)} strokes lost. You're leaving yourself in tough spots and not recovering. Better course management and short game touch needed.`,
            d => `Around the green, you lost ${sgFmt(d.sg.categories.short_game)} strokes. That's the most controllable part of your game. Dedicated short game practice is your best investment.`,
        ]
    },

    // ── TIER 1: Strong SG positives ──────────────────────────────────────────

    {
        code: 'SG_PUTTING_STRONG',
        condition: d => d.sg.categories.putting > 1.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `The putter was on fire today — you gained ${sgFmt(d.sg.categories.putting)} strokes putting. That's elite-level performance on the greens.`,
            d => `Putting was your superpower today at ${sgFmt(d.sg.categories.putting)} strokes gained. Your green reading and pace control were excellent.`,
            d => `You gained ${sgFmt(d.sg.categories.putting)} strokes with the putter — a genuine strength that saved your scorecard today.`,
            d => `${sgFmt(d.sg.categories.putting)} strokes gained putting. You were holing everything from inside 10 feet. That's championship-level putting.`,
            d => `Putting was a highlight at ${sgFmt(d.sg.categories.putting)} strokes gained. Your confidence on the greens was evident in every putt.`,
            d => `You gained ${sgFmt(d.sg.categories.putting)} strokes with the putter today. That kind of green reading and execution is what separates good golfers from great ones.`,
            d => `The greens were your playground — ${sgFmt(d.sg.categories.putting)} strokes gained putting. Keep this momentum going and protect this strength.`,
        ]
    },
    {
        code: 'SG_APPROACH_STRONG',
        condition: d => d.sg.categories.approach > 1.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `Ball striking was excellent today — ${sgFmt(d.sg.categories.approach)} strokes gained on approach shots. You were hitting it close consistently.`,
            d => `Your iron play gained you ${sgFmt(d.sg.categories.approach)} strokes today. That kind of approach play gives you birdie looks and takes pressure off the putter.`,
            d => `${sgFmt(d.sg.categories.approach)} strokes gained on approach — your irons were the standout part of your game today.`,
            d => `Approach shots were dialed in at ${sgFmt(d.sg.categories.approach)} strokes gained. You were leaving yourself inside 15 feet consistently.`,
            d => `${sgFmt(d.sg.categories.approach)} strokes gained on approach. Your distance control and accuracy with irons were exceptional today.`,
            d => `Iron play was a strength at ${sgFmt(d.sg.categories.approach)} strokes gained. You're hitting greens in regulation and setting up birdie opportunities.`,
            d => `You gained ${sgFmt(d.sg.categories.approach)} strokes on approach shots. That's the foundation of a great round — quality ball striking into the greens.`,
        ]
    },
    {
        code: 'SG_TOTAL_POSITIVE',
        condition: d => d.sg.total > 2.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `Overall you gained ${sgFmt(d.sg.total)} strokes against the single-digit baseline today — a genuinely strong performance across the board.`,
            d => `${sgFmt(d.sg.total)} total strokes gained is an impressive round. You outperformed the single-digit benchmark in multiple areas.`,
            d => `${sgFmt(d.sg.total)} strokes gained total. That's an elite-level performance. You're playing at a level well above your handicap.`,
            d => `You gained ${sgFmt(d.sg.total)} strokes today — a dominant all-around performance. This is the kind of round that builds confidence.`,
            d => `${sgFmt(d.sg.total)} strokes gained is exceptional. You executed well across all areas of your game today.`,
        ]
    },

    // ── TIER 2: Correlations ─────────────────────────────────────────────────

    {
        code: 'HIGH_FIR_LOW_GIR',
        condition: d => d.fir >= 55 && d.girPct < 35,
        severity: 'critical', tier: 2,
        messages: [
            d => `You hit ${d.fir}% of fairways but only ${d.girPct}% of greens — your driving is setting you up well but the irons aren't converting. Distance control on approach shots is the gap.`,
            d => `Great driving (${d.fir}% FIR) but only ${d.girPct}% GIR tells a clear story: the iron play isn't capitalizing on good tee shots. Focus on mid-iron proximity.`,
            d => `${d.fir}% fairways hit is solid, but ${d.girPct}% GIR means you're leaving shots out there. Your approach distances suggest a club selection or distance control issue.`,
            d => `You're in the fairway ${d.fir}% of the time but only hitting ${d.girPct}% of greens. That's a massive disconnect. Your irons need serious attention.`,
            d => `Fairways: ${d.fir}%. Greens: ${d.girPct}%. You're wasting good driving with poor iron play. Dial in your yardages and commit to your distances.`,
            d => `${d.fir}% FIR but ${d.girPct}% GIR is a red flag. You're not taking advantage of good positions off the tee. Iron accuracy is costing you 3-4 shots per round.`,
        ]
    },
    {
        code: 'LOW_FIR_HIGH_GIR',
        condition: d => d.fir < 35 && d.girPct >= 50,
        severity: 'info', tier: 2,
        messages: [
            d => `Interesting pattern — only ${d.fir}% fairways hit but ${d.girPct}% GIR. Your iron play is bailing out your driving. Imagine the scoring potential if you combined both.`,
            d => `You're hitting ${d.girPct}% of greens despite only ${d.fir}% fairways — impressive recovery iron play. Cleaning up the tee shots would make you even more dangerous.`,
            d => `${d.fir}% fairways but ${d.girPct}% GIR is a paradox. Your recovery game is elite, but you're working too hard. Better driving would unlock your true scoring potential.`,
            d => `Only ${d.fir}% fairways yet ${d.girPct}% GIR — you're a scrambling machine. Imagine what you'd score if you hit more fairways and didn't have to recover every hole.`,
            d => `You're making up for poor driving (${d.fir}% FIR) with exceptional iron play (${d.girPct}% GIR). That's unsustainable. Tee shots need to improve.`,
        ]
    },
    {
        code: 'THREE_PUTTS',
        condition: d => d.threePutts >= 2,
        severity: 'critical', tier: 2,
        messages: [
            d => `${d.threePutts} three-putts today — each one is a direct stroke wasted. Lag putting from long range is costing you. Focus on getting the first putt within 3 feet.`,
            d => `You three-putted ${d.threePutts} times. That alone accounts for ${d.threePutts} extra strokes. Distance control on long putts should be your putting practice focus.`,
            d => `${d.threePutts} three-putts is a scorecard killer. Speed control on putts over 20 feet would eliminate most of these.`,
            d => `Three-putts: ${d.threePutts}. That's ${d.threePutts} wasted strokes right there. Your lag putting needs immediate work — this is costing you 2-3 shots per round.`,
            d => `${d.threePutts} three-putts means you're not reading greens or controlling distance on long putts. Pick one and fix it — this is the fastest way to lower your score.`,
            d => `You three-putted ${d.threePutts} times today. That's unacceptable at any level. Spend 30 minutes a week on lag putting and this problem disappears.`,
        ]
    },
    {
        code: 'GOOD_SCRAMBLING',
        condition: d => d.scramblingPct >= 50 && d.girPct < 45,
        severity: 'positive', tier: 2,
        messages: [
            d => `You only hit ${d.girPct}% of greens but scrambled well — your short game saved several shots today. That fighting spirit kept the score respectable.`,
            d => `Missing ${100 - d.girPct}% of greens but still scoring well shows strong short game resilience. Your up-and-down ability is a real asset.`,
            d => `${d.scramblingPct}% scrambling despite ${d.girPct}% GIR is impressive. You're a tough competitor who doesn't give up on holes.`,
            d => `You got up-and-down ${d.scramblingPct}% of the time from off the green. That's a strength that's keeping your score competitive despite missing greens.`,
        ]
    },
    {
        code: 'POOR_SCRAMBLING',
        condition: d => d.scramblingPct < 25 && d.girPct < 45,
        severity: 'critical', tier: 2,
        messages: [
            d => `You missed ${100 - d.girPct}% of greens and only scrambled ${d.scramblingPct}% of the time — a double whammy. Chipping and putting from off the green needs significant work.`,
            d => `Missing greens and failing to get up-and-down (${d.scramblingPct}% scrambling) is the most expensive combination in golf. Short game practice would have the biggest impact on your scores.`,
            d => `${d.scramblingPct}% scrambling is brutal. You're not recovering from missed greens. This is costing you 4-5 shots per round.`,
            d => `Only ${d.scramblingPct}% scrambling rate means you're making double bogeys out of missed greens. Your short game is the biggest leak in your game right now.`,
            d => `${d.girPct}% GIR and ${d.scramblingPct}% scrambling is a disaster. You're missing greens and not saving par. This is where your practice time needs to go.`,
        ]
    },
    {
        code: 'HIGH_STRESS_POOR_SG',
        condition: d => d.avgStress > 55 && d.sg.total < -1.0,
        severity: 'warning', tier: 2,
        messages: [
            d => `Your average stress was ${d.avgStress} today and your SG was ${sgFmt(d.sg.total)} — high stress and poor performance often go hand in hand. Pre-shot routine and course management may help.`,
            d => `Elevated stress (avg ${d.avgStress}) combined with ${sgFmt(d.sg.total)} strokes gained suggests mental pressure may be affecting your swing. Breathing and routine work could help.`,
            d => `Stress level ${d.avgStress} and ${sgFmt(d.sg.total)} SG tells a story: you were tight all day. Work on staying calm and trusting your swing under pressure.`,
            d => `High stress (${d.avgStress}) correlates with poor performance (${sgFmt(d.sg.total)} SG). Your mental game needs as much work as your swing.`,
        ]
    },
    {
        code: 'HIGH_HR_LATE_ROUND',
        condition: d => d.lateRoundHr > d.earlyRoundHr + 8,
        severity: 'info', tier: 2,
        messages: [
            d => `Your heart rate climbed ${Math.round(d.lateRoundHr - d.earlyRoundHr)} bpm from the front to back nine — fatigue or pressure may have been a factor in the later holes.`,
            d => `HR was notably higher on the back nine (${Math.round(d.lateRoundHr)} vs ${Math.round(d.earlyRoundHr)} bpm). Physical conditioning or managing pressure late in rounds could be worth working on.`,
            d => `Back nine HR (${Math.round(d.lateRoundHr)} bpm) was significantly higher than front nine (${Math.round(d.earlyRoundHr)} bpm). You were feeling the pressure or fatigue late.`,
            d => `Your HR spiked ${Math.round(d.lateRoundHr - d.earlyRoundHr)} bpm from front to back nine. Better conditioning would help you stay calm and composed late in rounds.`,
        ]
    },
    {
        code: 'BODY_BATTERY_LOW',
        condition: d => d.bbEnd != null && d.bbEnd < 20,
        severity: 'warning', tier: 2,
        messages: [
            d => `Your Body Battery finished at ${d.bbEnd}% — you were running on empty by the end. Recovery before your next round is important.`,
            d => `Ending the round at ${d.bbEnd}% Body Battery suggests significant physical exertion. Sleep and recovery quality will affect your next performance.`,
            d => `Body Battery at ${d.bbEnd}% means you were completely drained by the end. Make sure to rest well before your next round.`,
            d => `You finished with only ${d.bbEnd}% Body Battery. That's exhaustion. Prioritize sleep and recovery to perform well next time.`,
        ]
    },
    {
        code: 'BODY_BATTERY_DRAIN_HIGH',
        condition: d => d.bbDrain != null && d.bbDrain > 40,
        severity: 'info', tier: 2,
        messages: [
            d => `You drained ${d.bbDrain}% Body Battery today — a demanding round physically. Make sure to prioritize recovery.`,
            d => `A ${d.bbDrain}% Body Battery drain is significant. Golf is more physically demanding than it looks, especially walking a full round.`,
            d => `${d.bbDrain}% Body Battery drain is a tough day physically. You earned your rest today.`,
            d => `You burned through ${d.bbDrain}% of your Body Battery. That's a serious physical effort. Recovery is key before your next round.`,
        ]
    },
    {
        code: 'FRONT_BACK_SPLIT_WORSE',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.backNineScore > d.frontNineScore + 4,
        severity: 'warning', tier: 2,
        messages: [
            d => `You scored ${d.frontNineScore} on the front but ${d.backNineScore} on the back — a ${d.backNineScore - d.frontNineScore} shot drop-off. Fatigue or concentration may be fading late in rounds.`,
            d => `Front nine: ${d.frontNineScore}, back nine: ${d.backNineScore}. That's a significant fade. Consider your energy management and course strategy for the second half.`,
            d => `${d.backNineScore - d.frontNineScore} shot swing from front to back nine. You're not finishing strong. Better conditioning or mental toughness needed late in rounds.`,
            d => `Front: ${d.frontNineScore}, back: ${d.backNineScore}. That's a pattern of fading. You need to manage your energy better in the second half.`,
            d => `You fell apart on the back nine (${d.backNineScore} vs ${d.frontNineScore}). Fatigue, pressure, or poor course management is costing you 4+ shots.`,
        ]
    },
    {
        code: 'FRONT_BACK_SPLIT_BETTER',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.frontNineScore > d.backNineScore + 3,
        severity: 'positive', tier: 2,
        messages: [
            d => `Strong finish — you improved ${d.frontNineScore - d.backNineScore} shots from front (${d.frontNineScore}) to back (${d.backNineScore}). You play better when warmed up.`,
            d => `Back nine (${d.backNineScore}) was much better than the front (${d.frontNineScore}). You clearly found your rhythm as the round progressed.`,
            d => `${d.frontNineScore - d.backNineScore} shot improvement from front to back nine. You finished strong — that's the sign of a competitor.`,
            d => `You got better as the round went on: front ${d.frontNineScore}, back ${d.backNineScore}. That's the mark of good course management and mental toughness.`,
            d => `Strong back nine (${d.backNineScore}) after a slow start (${d.frontNineScore}). You're a finisher — that's a valuable trait in golf.`,
        ]
    },
    {
        code: 'PAR3_STRUGGLES',
        condition: d => d.par3AvgOverPar > 0.8,
        severity: 'warning', tier: 2,
        messages: [
            d => `Par 3s averaged +${d.par3AvgOverPar.toFixed(1)} over par today — tee shots on short holes are costing you. Iron accuracy from the tee needs attention.`,
            d => `You struggled on par 3s (avg +${d.par3AvgOverPar.toFixed(1)}). These holes should be birdie or par opportunities — focus on hitting the green from the tee.`,
            d => `Par 3s are killing you at +${d.par3AvgOverPar.toFixed(1)} per hole. These are supposed to be scoring opportunities. Tee shot accuracy is the issue.`,
            d => `You're averaging +${d.par3AvgOverPar.toFixed(1)} on par 3s. That's unacceptable. These holes should be your best scoring opportunities.`,
        ]
    },
    {
        code: 'PAR5_SCORING',
        condition: d => d.par5AvgOverPar > 0.5,
        severity: 'warning', tier: 2,
        messages: [
            d => `Par 5s averaged +${d.par5AvgOverPar.toFixed(1)} today — these scoring holes aren't yielding birdies. Layup strategy and short game on par 5s could unlock lower scores.`,
            d => `You're not taking advantage of par 5s (avg +${d.par5AvgOverPar.toFixed(1)}). Better course management — knowing when to go for it vs lay up — could save strokes here.`,
            d => `Par 5s are costing you at +${d.par5AvgOverPar.toFixed(1)} per hole. You should be making birdies here. Course management and execution need work.`,
            d => `You're not capitalizing on par 5s (avg +${d.par5AvgOverPar.toFixed(1)}). These are your birdie holes. Better strategy and execution needed.`,
        ]
    },
    {
        code: 'PAR5_BIRDIE_MACHINE',
        condition: d => d.par5AvgOverPar < -0.3,
        severity: 'positive', tier: 2,
        messages: [
            d => `Par 5s are your scoring holes — averaging ${d.par5AvgOverPar.toFixed(1)} today. Your length and course management on these holes is a real strength.`,
            d => `You're eating up par 5s (avg ${d.par5AvgOverPar.toFixed(1)}). That's where your game is most dangerous.`,
            d => `Par 5s are your playground at ${d.par5AvgOverPar.toFixed(1)} per hole. You're making birdies when it counts.`,
            d => `${d.par5AvgOverPar.toFixed(1)} on par 5s is elite scoring. You're taking full advantage of the long holes.`,
        ]
    },
    {
        code: 'CONSECUTIVE_BOGEYS',
        condition: d => d.maxConsecutiveBogeys >= 3,
        severity: 'warning', tier: 2,
        messages: [
            d => `You had a run of ${d.maxConsecutiveBogeys} consecutive bogeys — momentum killers like this often come from one bad shot snowballing. Damage limitation and reset routines are key.`,
            d => `${d.maxConsecutiveBogeys} bogeys in a row at some point today. Breaking bad streaks early — taking your medicine and moving on — is a crucial mental skill.`,
            d => `${d.maxConsecutiveBogeys} consecutive bogeys is a momentum killer. You need a reset routine to stop the bleeding when things go wrong.`,
            d => `A streak of ${d.maxConsecutiveBogeys} bogeys cost you the round. Mental toughness and staying calm after a bad hole is critical.`,
        ]
    },

    // ── TIER 3: Club-specific ─────────────────────────────────────────────────

    {
        code: 'WORST_CLUB_SG',
        condition: d => d.worstClub != null && d.worstClub.avgSg < -0.3,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your ${d.worstClub.name} was your weakest club today (avg SG ${sgFmt(d.worstClub.avgSg)} over ${d.worstClub.shots} shots). Consider whether club selection or technique is the issue.`,
            d => `The ${d.worstClub.name} cost you the most strokes per shot (${sgFmt(d.worstClub.avgSg)} avg SG). It may be worth avoiding it in key situations until you've worked on it.`,
            d => `${d.worstClub.name} was a liability today — ${sgFmt(d.worstClub.avgSg)} avg SG. Targeted practice with this club would pay dividends.`,
            d => `Your ${d.worstClub.name} underperformed at ${sgFmt(d.worstClub.avgSg)} avg SG. Check your swing with this club on the range.`,
            d => `The ${d.worstClub.name} was your worst performer today (${sgFmt(d.worstClub.avgSg)} SG). This club needs attention before your next round.`,
        ]
    },
    {
        code: 'BEST_CLUB_SG',
        condition: d => d.bestClub != null && d.bestClub.avgSg > 0.2,
        severity: 'positive', tier: 3,
        messages: [
            d => `Your ${d.bestClub.name} was your best club today — ${sgFmt(d.bestClub.avgSg)} avg SG over ${d.bestClub.shots} shots. Lean on it when you need a reliable shot.`,
            d => `The ${d.bestClub.name} was dialed in today (${sgFmt(d.bestClub.avgSg)} avg SG). That's a club you can trust under pressure.`,
            d => `${d.bestClub.name} was your standout club at ${sgFmt(d.bestClub.avgSg)} avg SG. You can rely on this club in key moments.`,
            d => `Your ${d.bestClub.name} performed excellently today (${sgFmt(d.bestClub.avgSg)} SG). This is your go-to club.`,
        ]
    },
    {
        code: 'DRIVER_INCONSISTENT',
        condition: d => d.driverClub != null && d.driverClub.distStd > 30,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver had high distance variance (±${Math.round(d.driverClub.distStd)} yds) — some big ones and some short ones. A more controlled, repeatable swing may trade a little distance for a lot more consistency.`,
            d => `Driver distance was all over the place today (±${Math.round(d.driverClub.distStd)} yds std dev). Tee it down slightly and focus on center contact over maximum distance.`,
            d => `Your Driver variance (±${Math.round(d.driverClub.distStd)} yds) is too high. Consistency beats distance. Work on a repeatable swing.`,
            d => `Driver distances ranged wildly (±${Math.round(d.driverClub.distStd)} yds). You need a more controlled swing off the tee.`,
        ]
    },
    {
        code: 'DRIVER_RIGHT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev > 12,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver has a consistent right bias (+${Math.round(d.driverClub.avgDev)}° avg) — a push or push-fade pattern. Check your alignment and club face at impact.`,
            d => `Tee shots are trending right (+${Math.round(d.driverClub.avgDev)}° avg deviation). This could be alignment, an open face, or an out-to-in swing path. Worth checking on the range.`,
            d => `Your Driver is pushing right (+${Math.round(d.driverClub.avgDev)}° avg). This is costing you fairways. Fix your alignment or swing path.`,
            d => `Consistent right miss with Driver (+${Math.round(d.driverClub.avgDev)}°). Check your setup and club face angle.`,
        ]
    },
    {
        code: 'DRIVER_LEFT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev < -12,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver is pulling left (${Math.round(d.driverClub.avgDev)}° avg) — a hook or pull pattern. Check your grip pressure and swing path.`,
            d => `Tee shots are consistently left (${Math.round(d.driverClub.avgDev)}° avg deviation). A closed face or in-to-out path is likely the cause.`,
            d => `Your Driver has a left bias (${Math.round(d.driverClub.avgDev)}° avg). This is a systematic issue. Work on your swing path on the range.`,
            d => `Consistent left miss with Driver (${Math.round(d.driverClub.avgDev)}°). Check your grip and club face at address.`,
        ]
    },
    {
        code: 'IRONS_RIGHT_BIAS',
        condition: d => d.ironBias > 15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your irons have a consistent right bias (+${Math.round(d.ironBias)}° avg) — a push or fade pattern. This is likely a systematic swing issue worth addressing on the range.`,
            d => `Iron shots are trending right (+${Math.round(d.ironBias)}° avg). Check your ball position and ensure your body is aligned left of the target, not the club face.`,
            d => `Irons pushing right (+${Math.round(d.ironBias)}° avg). This is costing you accuracy. Work on your alignment and swing path.`,
            d => `Your irons have a right bias (+${Math.round(d.ironBias)}°). Check your setup and ensure you're not aiming right.`,
        ]
    },
    {
        code: 'IRONS_LEFT_BIAS',
        condition: d => d.ironBias < -15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your irons are pulling left (${Math.round(d.ironBias)}° avg) — a pull or draw pattern. Check your takeaway and ensure you're not coming over the top.`,
            d => `Iron shots consistently miss left (${Math.round(d.ironBias)}° avg deviation). An over-the-top swing path or closed face at impact is the likely culprit.`,
            d => `Irons pulling left (${Math.round(d.ironBias)}° avg). This is a swing path issue. Work on staying on plane.`,
            d => `Your irons have a left bias (${Math.round(d.ironBias)}°). Check your swing path and ensure you're not over-the-top.`,
        ]
    },
    {
        code: 'WEDGE_INCONSISTENT',
        condition: d => d.wedgeClub != null && d.wedgeClub.distStd > 15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Wedge distances were inconsistent today (±${Math.round(d.wedgeClub.distStd)} yds). Dialing in your wedge yardages through practice is one of the highest-ROI things you can do.`,
            d => `Your wedge play had high variance (±${Math.round(d.wedgeClub.distStd)} yds std dev). Knowing your exact carry distances for each wedge is critical for scoring.`,
            d => `Wedge distance variance (±${Math.round(d.wedgeClub.distStd)} yds) is too high. You need to dial in your yardages.`,
            d => `Your wedges are inconsistent (±${Math.round(d.wedgeClub.distStd)} yds). Spend time on the range dialing in exact distances.`,
        ]
    },
    {
        code: 'WEDGE_STRONG',
        condition: d => d.wedgeClub != null && d.wedgeClub.avgSg > 0.15,
        severity: 'positive', tier: 3,
        messages: [
            d => `Wedge play was a strength today — ${sgFmt(d.wedgeClub.avgSg)} avg SG. Your distance control inside 100 yards is giving you birdie looks.`,
            d => `Your wedges were dialed in today (${sgFmt(d.wedgeClub.avgSg)} avg SG). That kind of short game precision is what separates good rounds from great ones.`,
            d => `Wedge play was excellent at ${sgFmt(d.wedgeClub.avgSg)} avg SG. You're scoring well inside 100 yards.`,
            d => `Your wedges performed well today (${sgFmt(d.wedgeClub.avgSg)} SG). This is a strength to build on.`,
        ]
    },

    // ── TIER 3: Dispersion patterns ───────────────────────────────────────────

    {
        code: 'APPROACH_SHORT_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.shortPct > 55,
        severity: 'warning', tier: 3,
        messages: [
            d => `You're leaving approach shots short ${d.approachDispersion.shortPct}% of the time from ${d.approachDispersion.label}. Club up — most amateur golfers consistently underclub on approach shots.`,
            d => `${d.approachDispersion.shortPct}% of your approach shots from ${d.approachDispersion.label} came up short. Take one more club and make a smooth swing rather than forcing a longer club.`,
            d => `Approach shots short ${d.approachDispersion.shortPct}% of the time from ${d.approachDispersion.label}. You're underclubbing. Trust the yardage and take more club.`,
            d => `${d.approachDispersion.shortPct}% short from ${d.approachDispersion.label}. This is a pattern. Club selection needs adjustment.`,
        ]
    },
    {
        code: 'APPROACH_LONG_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.longPct > 45,
        severity: 'warning', tier: 3,
        messages: [
            d => `You're flying approach shots long ${d.approachDispersion.longPct}% of the time from ${d.approachDispersion.label}. Check your yardages — adrenaline or wind may be adding distance.`,
            d => `${d.approachDispersion.longPct}% of approaches from ${d.approachDispersion.label} went long. Club down and focus on solid contact rather than swinging harder.`,
            d => `Approach shots long ${d.approachDispersion.longPct}% of the time from ${d.approachDispersion.label}. You're overclubbing. Take less club.`,
            d => `${d.approachDispersion.longPct}% long from ${d.approachDispersion.label}. This is a pattern. Dial back your club selection.`,
        ]
    },
    {
        code: 'DISPERSION_TIGHT',
        condition: d => d.overallDispersionAngle < 12 && d.sg.catCounts.approach >= 4,
        severity: 'positive', tier: 3,
        messages: [
            d => `Your shot dispersion was tight today (avg ${Math.round(d.overallDispersionAngle)}° deviation) — you were hitting it consistently in the same direction. That's a sign of a repeatable swing.`,
            d => `Directional consistency was strong today — only ${Math.round(d.overallDispersionAngle)}° average deviation. A repeatable ball flight makes course management much easier.`,
            d => `Tight dispersion (${Math.round(d.overallDispersionAngle)}° avg) shows excellent consistency. Your swing is repeatable.`,
            d => `${Math.round(d.overallDispersionAngle)}° average deviation is excellent. You're hitting it straight and consistent.`,
        ]
    },

    // ── TIER 4: Minor observations & positives ────────────────────────────────

    {
        code: 'ONE_PUTTS_HIGH',
        condition: d => d.onePutts >= 4,
        severity: 'positive', tier: 4,
        messages: [
            d => `${d.onePutts} one-putts today — you were holing out from close range consistently. That's a real scoring asset.`,
            d => `${d.onePutts} one-putts is excellent. Your ability to convert from short range kept the scorecard clean.`,
            d => `${d.onePutts} one-putts shows great short-range putting. You're capitalizing on birdie opportunities.`,
            d => `${d.onePutts} one-putts is impressive. Your confidence on short putts is a strength.`,
        ]
    },
    {
        code: 'PUTTING_DISTANCE_CONTROL',
        condition: d => d.threePutts === 0 && d.sc?.total_putts <= d.sc?.hole_scores?.length * 1.8,
        severity: 'positive', tier: 4,
        messages: [
            d => `Zero three-putts today — your lag putting distance control was excellent. That's a sign of good green reading and pace judgment.`,
            d => `No three-putts is a great achievement. Your distance control on long putts kept you out of trouble all round.`,
            d => `Perfect lag putting today with zero three-putts. Your speed control is excellent.`,
            d => `Zero three-putts shows great putting fundamentals. You're managing distance well.`,
        ]
    },
    {
        code: 'DISTANCE_WALKED',
        condition: d => d.distanceKm > 8,
        severity: 'info', tier: 4,
        messages: [
            d => `You walked ${d.distanceKm.toFixed(1)} km today — golf is more of a workout than people give it credit for. Good physical conditioning helps maintain focus late in rounds.`,
            d => `${d.distanceKm.toFixed(1)} km walked is a solid workout. You earned your rest today.`,
            d => `Walking ${d.distanceKm.toFixed(1)} km today shows you're getting good exercise. Golf is a full-body activity.`,
        ]
    },
    {
        code: 'ALTITUDE_RANGE',
        condition: d => d.altRange > 30,
        severity: 'info', tier: 4,
        messages: [
            d => `The course had ${Math.round(d.altRange)}m of elevation change today. Remember that altitude affects ball flight — uphill shots play longer, downhill shots play shorter.`,
            d => `Significant elevation change (${Math.round(d.altRange)}m) means club selection needs to account for uphill and downhill lies. This is a skill that improves with course experience.`,
            d => `${Math.round(d.altRange)}m of elevation change is significant. You need to adjust for uphill and downhill shots.`,
            d => `The course had notable elevation (${Math.round(d.altRange)}m). This affects distance calculations. Account for it in future rounds.`,
        ]
    },
    {
        code: 'SWING_TEMPO_FAST',
        condition: d => d.avgTempo != null && d.avgTempo < 2.5,
        severity: 'warning', tier: 4,
        messages: [
            d => `Your avg swing tempo was ${d.avgTempo.toFixed(1)}:1 today — on the fast side. A slightly longer backswing pause often leads to better sequencing and more consistent contact.`,
            d => `Tempo at ${d.avgTempo.toFixed(1)}:1 is quick. Many tour pros are around 3:1. Slowing the transition slightly can improve both distance and accuracy.`,
            d => `Your tempo (${d.avgTempo.toFixed(1)}:1) is too quick. Slow down your transition for better control.`,
            d => `Fast tempo (${d.avgTempo.toFixed(1)}:1) may be affecting consistency. Work on a smoother rhythm.`,
        ]
    },
    {
        code: 'SWING_TEMPO_GOOD',
        condition: d => d.avgTempo != null && d.avgTempo >= 2.8 && d.avgTempo <= 3.5,
        severity: 'positive', tier: 4,
        messages: [
            d => `Your swing tempo (${d.avgTempo.toFixed(1)}:1) is in the ideal range. Good tempo is the foundation of consistent ball striking.`,
            d => `Tempo was solid today at ${d.avgTempo.toFixed(1)}:1 — right in the zone for consistent, powerful swings.`,
            d => `Excellent tempo (${d.avgTempo.toFixed(1)}:1). You're in the sweet spot for consistency.`,
            d => `Your tempo (${d.avgTempo.toFixed(1)}:1) is ideal. Keep this rhythm going.`,
        ]
    },
    {
        code: 'ROUND_DURATION_LONG',
        condition: d => d.durationMin > 270,
        severity: 'info', tier: 4,
        messages: [
            d => `The round took ${Math.round(d.durationMin)} minutes — a long day out. Mental fatigue over 4+ hours can affect decision-making and focus on the back nine.`,
            d => `${Math.round(d.durationMin)} minutes is a long round. Pace of play affects mental stamina. Try to keep rounds under 4.5 hours.`,
            d => `A ${Math.round(d.durationMin)}-minute round is tiring. Faster play helps maintain focus.`,
        ]
    },
    {
        code: 'SG_BALANCED',
        condition: d => Object.values(d.sg.categories).every(v => Math.abs(v) < 0.5),
        severity: 'info', tier: 4,
        messages: [
            d => `Your strokes gained were balanced across all categories today — no single area was a disaster or a standout. Consistent all-round play is a solid foundation.`,
            d => `No glaring weaknesses in the SG numbers today — everything was within half a stroke of baseline. That kind of balance is hard to achieve.`,
            d => `Balanced performance across all categories. You played steady golf today.`,
            d => `No major strengths or weaknesses in SG. You played a consistent, even round.`,
        ]
    },
];

