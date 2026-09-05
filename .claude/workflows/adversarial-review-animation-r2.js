export const meta = {
  name: 'review-live-markdown-preview',
  description: 'three-lens adversarial review of the live markdown preview, adjudicated, plan exits to the main session, pinned confirms on each applied delta',
  phases: [
    { title: 'Discover', detail: 'architect, ux-designer and bug-hunter over the full scope' },
    { title: 'Adjudicate', detail: 'materiality triage, then the change plan or a clean ruling' },
    { title: 'Confirm', detail: 'pinned re-review of the closures and the applied delta' },
  ],
}

// INV-1: no run without a bar naming purpose, input universe and primary path.
if (!args || !args.target || !args.bar || !Array.isArray(args.lenses) || !args.lenses.length) {
  throw new Error('args.target, args.bar and args.lenses are mandatory')
}
if (typeof args.bar !== 'object' || !args.bar.purpose || !args.bar.inputs || !args.bar.primaryPath) {
  throw new Error('args.bar must carry purpose, inputs and primaryPath')
}
const TARGET = args.target
const SCOPE = args.scope || 'the named target only'
const CONTEXT = args.context || ''
const BAR = args.bar
const LENSES = args.lenses
const MAX_ROUNDS = args.maxRounds || 6
const CLEAN_REQUIRED = args.cleanRequired || 2
const MAX_CHANGES = args.maxChanges || 3

// INV-8: material and materiality are required on every finding.
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'title', 'file', 'evidence', 'material', 'materiality', 'remedy'],
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
          taste: { type: 'boolean' },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          evidence: { type: 'string', description: 'what was observed or reproduced, with the exact input' },
          material: { type: 'boolean', description: 'true ONLY when a user on the primary path, with an input inside the input universe, is harmed' },
          materiality: { type: 'string', description: 'who is harmed, doing what the product is for, on which input - or NONE and why' },
          remedy: { type: 'string', description: 'smallest EDIT that removes the cause, or DEFER; a remedy adding a pass, branch, helper or data shape opens with NEW MECHANISM' },
          outOfBar: { type: 'boolean' },
          closure: { type: 'string', description: 'confirming rounds only: the closure this finding fails, or whose change caused a regression elsewhere' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

// INV-9: reverts and newMechanism are required in every adjudication.
const ADJUDICATION_SCHEMA = {
  type: 'object',
  required: ['ruling', 'changes', 'reverts', 'fanoutTraced', 'fanoutTotal', 'trajectory', 'trajectoryReason'],
  properties: {
    ruling: { type: 'string', enum: ['PROCEED', 'PROCEED_WITH_DEFERRALS', 'STOP'] },
    changes: {
      type: 'array',
      description: 'the change plan ranked by materiality; EMPTY when no finding warrants a change - that rules the round clean',
      items: {
        type: 'object',
        required: ['answers', 'site', 'change', 'radius', 'newMechanism'],
        properties: {
          answers: { type: 'array', items: { type: 'string' } },
          site: { type: 'string' },
          change: { type: 'string' },
          radius: { type: 'string' },
          newMechanism: { type: 'boolean' },
        },
      },
    },
    reverts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mechanism', 'site', 'dissolves', 'defers'],
        properties: {
          mechanism: { type: 'string' },
          site: { type: 'string' },
          dissolves: { type: 'array', items: { type: 'string' } },
          defers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    deferred: { type: 'array', items: { type: 'string' } },
    refuted: { type: 'array', items: { type: 'string' } },
    fanoutTraced: { type: 'integer' },
    fanoutTotal: { type: 'integer' },
    trajectory: { type: 'string', enum: ['converging', 'spiralling'] },
    trajectoryReason: { type: 'string' },
  },
}

// INV-2: severity tally is reporting only, never a gate.
const severityTally = (findings) =>
  ['CRITICAL', 'MAJOR', 'MINOR'].map((s) => `${s}:${findings.filter((f) => f.severity === s).length}`).join(' ')

// INV-8: immaterial findings are capped before adjudication.
const capImmaterial = (findings) => {
  let capped = 0
  findings.forEach((f) => {
    if (f.material === false && f.severity !== 'MINOR') {
      Object.assign(f, { severity: 'MINOR', outOfBar: true, cappedFrom: f.severity })
      capped += 1
    }
  })
  if (capped) log(`materiality cap: ${capped} immaterial finding(s) reduced to MINOR/outOfBar`)
  return findings
}

const panelDied = (perLens) => perLens.every((rep) => !rep)
let panelDeath = null

const mergeFindings = (perLens) => {
  const rows = []
  perLens.forEach((rep, i) => {
    ;(rep && rep.findings ? rep.findings : []).forEach((f) => {
      const hit = rows.find(
        (r) =>
          (r.file === f.file && r.line != null && f.line != null && Math.abs(r.line - f.line) <= 25) ||
          r.title.toLowerCase().trim() === f.title.toLowerCase().trim()
      )
      if (hit) {
        hit.lenses.push(LENSES[i])
        if (f.severity === 'CRITICAL' && hit.severity !== 'CRITICAL') Object.assign(hit, { severity: 'CRITICAL' })
      } else {
        rows.push(Object.assign({}, f, { lenses: [LENSES[i]] }))
      }
    })
  })
  return capImmaterial(rows)
}

const barBlock = [
  `BAR (severity is judged against THIS, not against all inputs in the world):`,
  `PURPOSE: ${BAR.purpose}`,
  `INPUT UNIVERSE: ${BAR.inputs}`,
  `PRIMARY PATH (every CRITICAL or MAJOR must sit on it): ${BAR.primaryPath}`,
  BAR.guarantees ? `GUARANTEES: ${BAR.guarantees}` : null,
  BAR.outOfScope ? `OUT OF SCOPE: ${BAR.outOfScope}` : null,
  BAR.degrade ? `DEGRADE GRACEFULLY COVERS: ${BAR.degrade}` : null,
  `The script caps material=false at MINOR/outOfBar whatever the reproduction shows.`,
]
  .filter(Boolean)
  .join('\n')

// INV-6: reviewers are the read-only reviewer agent and are told not to modify anything.
const reviewerPrompt = (lens, body) =>
  [
    `Adversary lens: ${lens}. Adopt that persona file exactly. Do not modify any file.`,
    `TARGET: ${TARGET}`,
    `SCOPE: ${SCOPE}`,
    CONTEXT ? `CONTEXT: ${CONTEXT}` : null,
    barBlock,
    body,
    `Return your findings through the structured output tool; no prose report.`,
  ]
    .filter(Boolean)
    .join('\n\n')

const runPanel = async (phase, body) => {
  const raw = await parallel(
    LENSES.map((lens) => () =>
      agent(reviewerPrompt(lens, body), {
        label: `${phase.toLowerCase()}:${lens}`,
        phase,
        schema: FINDINGS_SCHEMA,
        agentType: 'devils-advocate:adversarial-reviewer',
      })
    )
  )
  if (panelDied(raw)) panelDeath = { phase, lenses: LENSES.length }
  return raw
}

// INV-3: loop state threads across invocations through the PLAN return.
// The state of the loop that shipped the live preview, carried forward so
// nothing it settled is re-litigated; the clean streak starts again.
const EMBEDDED_STATE = {"round": 1, "cleanStreak": 0, "spiralStreak": 0, "history": [{"round": 1, "kind": "discover", "findings": 14, "severities": "CRITICAL:0 MAJOR:3 MINOR:11"}], "deferred": ["MINOR (material, cosmetic): ghost of a removed or renamed heading is inserted as the first child of the following table, list, pre or mermaid container (highlight.ts:305, ghostAnchor into(next)) - CONFIRMED by S4 in jsdom. Deferred: cosmetic misplacement for 750 ms, no invariant broken, and the remedy is a new element-type check that a MINOR does not earn this round. Stays live: the struck heading text is drawn inside the table/list box; inside a mermaid container it is lost when the renderer replaces the children (tolerated by undecorate and the animator). File through pm-tools as a defect with the S4 inputs.", "MINOR (doc only): ACC-ANIM-79 mechanism note says decorate marks heading spans as not animatable; the heading exclusion is element.closest(HEADINGS) in ChangeAnimator.start and decorate only places ghosts outside headings. CONFIRMED false statement. Deferred to a pm-tools text edit by the main session; no code surface, not counted against the change budget. Stays live: the note points a maintainer at the wrong module.", "MINOR (material): finding 12 parts (c),(d) - the heading ghost relocation differs from HEAD at speed 0. Not a defect: HEAD put the ghost inside the h2 and changed heading text, breaking the heading guarantee; the tree meets it. The bar's 'byte for byte the pre-animation behaviour' guarantee needs a one-clause exception naming the heading relocation; the bar owner writes it, not the code.", "MINOR (test only): Galata 'green background while typing' regex accepts rgba(0, 0, 0, 0). CONFIRMED from the pattern. Deferred: verification gap, no reader harmed; tighten to not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)') when ui-tests/tests/live-view.spec.ts is next edited by the main session. Stays live: a base.css regression on the typing tint would pass the suite."], "refuted": ["MINOR: prefersReducedMotion in animate.ts duplicates this._motionQuery in controller.ts - CONFIRMED as fact, refuted as immaterial: both readers return the same live value, no reader sees a wrong speed; the cost is one MediaQueryList allocation per decorated render. Fold into a later cleanup, not a review-loop change.", "MINOR: coarse bound defined three times (diff.ts:138, highlight.ts:413, controller.ts:370) - CONFIRMED as fact, refuted as immaterial: all three agree today; maintainer risk only.", "MINOR (taste): two channels for animator metadata (offsets WeakMap vs --jp-AdvancedMd-fade-in) - refuted as immaterial; writer and reader sit in one file. Change 1 also removes wasShownBefore's use for ghosts, leaving it for added runs only.", "MINOR: animationSpeed description does not say reduced motion overrides it - refuted as immaterial: not on the primary path; a settings-editor visit under reduced motion is the only exposure. The one-sentence description edit is the bar owner's call if wanted.", "MINOR (taste): deletion runs at typing speed - declined as taste; the bar names the order (hold, delete backwards, leave) and not the deletion rate.", "MINOR: _applySpeed re-arms the fade with remainingMs() 0 when nothing is running (controller.ts:449) - CONFIRMED by S6 (decoration present at 1400 ms, gone at 2700 ms), refuted as immaterial: requires a speed-setting or OS motion-preference change while a fade is pending; the effect is the highlight staying up to one fadeDuration longer. A guard needs the input that makes it necessary on the primary path, and none is named."], "rulings": [{"round": 1, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 2, "reverts": 0, "fanout": "0/14", "trajectory": "converging"}], "closures": []}
const S = EMBEDDED_STATE
const history = S ? S.history : []
const allDeferred = S ? S.deferred : []
const allRefuted = S ? S.refuted : []
const rulings = S ? S.rulings : []
const closures = S ? S.closures : []
let round = S ? S.round : 0
let cleanStreak = S ? S.cleanStreak : 0
let spiralStreak = S ? S.spiralStreak : 0
let shipped = false

const newDelta = S && Array.isArray(args.appliedFixes) ? args.appliedFixes : []
newDelta.forEach((f) => closures.push({ round, site: f.site, summary: f.summary, files: f.files || [] }))

// INV-7: the full record returned on every status.
const stateOut = () => ({ round, cleanStreak, spiralStreak, history, deferred: allDeferred, refuted: allRefuted, rulings, closures })
const record = () => ({ history, closures, deferred: allDeferred, refuted: allRefuted, state: stateOut() })

// INV-3: the adjudicator starts fresh each round; this record is its continuity.
const priorRecord = () =>
  [
    `PRIOR ADJUDICATIONS (you start fresh each round - this record is your continuity; do not re-litigate what it settled unless this round brings NEW evidence):`,
    `Rulings: ${rulings.length ? rulings.map((r) => `round ${r.round} ${r.ruling} (${r.changes} changes, ${r.reverts} reverts, fanout ${r.fanout}, ${r.trajectory})`).join('; ') : '(none - first adjudication)'}`,
    `Refuted (stay refuted absent new evidence):`,
    allRefuted.length ? allRefuted.map((r) => `- ${r}`).join('\n') : '(none)',
    `Deferred (stay deferred absent new evidence):`,
    allDeferred.length ? allDeferred.map((d) => `- ${d}`).join('\n') : '(none)',
  ].join('\n')

const confirmBody = () =>
  [
    `This is a CONFIRMING round, pinned - not a fresh sweep. Two jobs only:`,
    `1. Reproduce each closure below and verify the defect is gone - a closure that is NOT closed is reported with its text in the closure field.`,
    `2. Attack what the applied changes could have broken - the applied delta is your only attack surface; do not review code the changes did not touch. A regression outside the delta's own files is reported with the causing closure quoted in the closure field; the script discards a finding that names no closure and sits outside the delta.`,
    `TURN BUDGET: read the delta, reproduce the closures, run the unit test command once, report. No inventory, no prose or naming audits, no taste.`,
    `CLOSURES (all applied so far):`,
    closures.length ? closures.map((c) => `- ${c.site}: ${c.summary}`).join('\n') : '(none applied - verify the clean state holds)',
    `NEWEST DELTA (this invocation's primary attack surface):`,
    newDelta.length ? newDelta.map((c) => `- ${c.site}: ${c.summary}${c.files && c.files.length ? ` [${c.files.join(', ')}]` : ''}`).join('\n') : '(none new)',
  ].join('\n')

// INV-4: pinned confirm filter - closure named or inside the applied delta, discards logged.
const stem = (p) => (p || '').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
const inDelta = (f) => {
  const s = stem(f.file)
  if (!s) return false
  return closures.some((c) => (c.files || []).some((p) => stem(p) === s) || (c.site || '').toLowerCase().includes(s))
}
const pinFilter = (findings) => {
  const kept = []
  const dropped = []
  findings.forEach((f) => {
    if (!f.taste && ((f.closure && f.closure.trim()) || inDelta(f))) kept.push(f)
    else dropped.push(f)
  })
  if (dropped.length) {
    log(`confirm filter: ${dropped.length} finding(s) discarded - taste or outside the applied delta: ${dropped.map((d) => d.title).join(' | ')}`)
    history.push({ round, kind: 'confirm-filter', discarded: dropped.map((d) => `${d.file}: ${d.title}`) })
  }
  return kept
}

let findings
round += 1
if (!S) {
  phase('Discover')
  log(`round 1 discovery: ${LENSES.join(', ')} over ${TARGET}`)
  findings = mergeFindings(await runPanel('Discover', `This is a discovery round: the full scope against the bar.`))
  history.push({ round, kind: 'discover', findings: findings.length, severities: severityTally(findings) })
} else {
  log(`round ${round} confirming: pinned to ${closures.length} closure(s), ${newDelta.length} new`)
  findings = pinFilter(mergeFindings(await runPanel('Confirm', confirmBody())))
  history.push({ round, kind: 'confirm', findings: findings.length, severities: severityTally(findings) })
}
if (panelDeath) return Object.assign({ status: 'PANEL_DIED', reason: `every reviewer in the ${panelDeath.phase} panel died - relaunch, never read as clean`, round, findings: [] }, record())

while (true) {
  if (!findings.length) {
    cleanStreak += 1
    spiralStreak = 0
    log(`round ${round} clean - no findings (${cleanStreak}/${CLEAN_REQUIRED} consecutive)`)
    // INV-5: exit only on the required consecutive clean rounds.
    if (cleanStreak >= CLEAN_REQUIRED || (round === 1 && !S)) {
      shipped = true
      break
    }
  } else {
    // INV-3: every round with findings is adjudicated before any change.
    const adj = await agent(
      [
        `You adjudicate adversarial-review findings for ${TARGET}.`,
        barBlock,
        priorRecord(),
        `FINDINGS (round ${round}, ${findings.length}: ${severityTally(findings)}; findings carrying cappedFrom were reduced by the script for material=false):`,
        JSON.stringify(findings, null, 2),
        `CHANGES APPLIED IN PREVIOUS ROUNDS (the revert candidates; fanoutTraced counts against these):`,
        closures.length ? closures.map((c) => `round ${c.round} ${c.site}: ${c.summary}`).join('\n') : '(none - round 1)',
        `CHANGE BUDGET: ${MAX_CHANGES}`,
        `TRAJECTORY: judge it - converging or spiralling - and say why.`,
      ].join('\n\n'),
      { label: `adjudicate:r${round}`, phase: 'Adjudicate', schema: ADJUDICATION_SCHEMA, agentType: 'devils-advocate:adjudicator' }
    )
    if (!adj) return Object.assign({ status: 'ADJUDICATOR_DIED', round, findings }, record())
    const reverts = adj.reverts || []
    allDeferred.push(...(adj.deferred || []))
    allRefuted.push(...(adj.refuted || []))
    rulings.push({ round, ruling: adj.ruling, changes: adj.changes.length, reverts: reverts.length, fanout: `${adj.fanoutTraced}/${adj.fanoutTotal}`, trajectory: adj.trajectory })
    log(`round ${round} adjudicated: ${adj.ruling}, ${adj.changes.length} changes, ${reverts.length} reverts, fanout ${adj.fanoutTraced}/${adj.fanoutTotal}, ${adj.trajectory} - ${adj.trajectoryReason}`)
    // INV-9: new mechanisms are surfaced for veto; the plan budget is advisory.
    const mechanisms = adj.changes.filter((c) => c.newMechanism)
    if (mechanisms.length) log(`round ${round}: ${mechanisms.length} change(s) add a NEW MECHANISM - veto unless each answers a material CRITICAL/MAJOR: ${mechanisms.map((m) => m.site).join(' | ')}`)
    if (adj.changes.length > MAX_CHANGES) log(`round ${round}: plan carries ${adj.changes.length} changes against a budget of ${MAX_CHANGES} - apply the top ${MAX_CHANGES}, defer the rest`)
    // INV-5: adjudicator STOP is a terminal state; INV-9: reverts ride on it.
    if (adj.ruling === 'STOP') {
      return Object.assign({ status: 'STOP', reason: 'adjudicator ruled the loop is generating its own work - revert the listed mechanisms, defer what they answered, re-model', round, findings, reverts: reverts.length ? reverts : closures }, record())
    }
    // INV-5: the fanout stop is the adjudicator's judgment over two consecutive refining rounds.
    const refining = adj.changes.length > 0 || reverts.length > 0
    spiralStreak = adj.trajectory === 'spiralling' && refining ? spiralStreak + 1 : 0
    if (spiralStreak >= 2) {
      return Object.assign({ status: 'FANOUT_STOP', reason: 'the adjudicator judged the loop spiralling in two consecutive rounds (' + adj.trajectoryReason + ')', round, findings, reverts: reverts.length ? reverts : closures }, record())
    }
    if (adj.changes.length || reverts.length) {
      // INV-3 and INV-6: a non-empty plan EXITS; the workflow never edits the tree.
      cleanStreak = 0
      return Object.assign(
        {
          status: 'PLAN',
          reverts,
          mechanisms,
          plan: adj.changes,
          fanout: `${adj.fanoutTraced}/${adj.fanoutTotal}`,
          trajectory: adj.trajectory,
          instructions: 'Apply ONLY this plan in the main session: first reverts, then plan - exact changes, smallest radius, nothing else. Veto any mechanisms entry not answering a material CRITICAL/MAJOR. Run the unit tests. Re-invoke with args.state = state (verbatim) and args.appliedFixes = [{site, summary, files}]; reverts recorded with summary starting "reverted: <mechanism>".',
          round,
          findings,
        },
        record()
      )
    }
    // INV-2: an empty adjudicated change plan rules the round clean.
    cleanStreak += 1
    log(`round ${round} adjudicated clean - no change warranted (${cleanStreak}/${CLEAN_REQUIRED} consecutive)`)
    if (cleanStreak >= CLEAN_REQUIRED || (round === 1 && !S)) {
      shipped = true
      break
    }
  }
  // INV-5: round cap.
  if (round >= MAX_ROUNDS) break
  round += 1
  log(`round ${round} confirming: pinned to ${closures.length} closure(s)`)
  findings = pinFilter(mergeFindings(await runPanel('Confirm', confirmBody())))
  if (panelDeath) return Object.assign({ status: 'PANEL_DIED', reason: `every reviewer in the ${panelDeath.phase} panel died - relaunch, never read as clean`, round, findings: [] }, record())
  history.push({ round, kind: 'confirm', findings: findings.length, severities: severityTally(findings) })
}

// INV-7: full record on the terminal return.
return Object.assign({ status: shipped ? 'SHIP' : 'ROUND_CAP', rounds: round, openFindings: findings }, record())