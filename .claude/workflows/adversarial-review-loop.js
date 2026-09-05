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
const EMBEDDED_STATE = {"round": 8, "cleanStreak": 0, "spiralStreak": 0, "history": [{"round": 1, "kind": "discover", "findings": 17, "severities": "CRITICAL:0 MAJOR:7 MINOR:10"}, {"round": 2, "kind": "confirm", "findings": 3, "severities": "CRITICAL:0 MAJOR:2 MINOR:1"}, {"round": 3, "kind": "confirm", "findings": 3, "severities": "CRITICAL:0 MAJOR:1 MINOR:2"}, {"round": 4, "kind": "confirm", "findings": 3, "severities": "CRITICAL:0 MAJOR:0 MINOR:3"}, {"round": 5, "kind": "confirm", "findings": 2, "severities": "CRITICAL:0 MAJOR:0 MINOR:2"}, {"round": 6, "kind": "confirm", "findings": 6, "severities": "CRITICAL:0 MAJOR:2 MINOR:4"}, {"round": 7, "kind": "confirm", "findings": 2, "severities": "CRITICAL:0 MAJOR:0 MINOR:2"}, {"round": 8, "kind": "confirm", "findings": 4, "severities": "CRITICAL:0 MAJOR:1 MINOR:3"}], "deferred": ["F1 and F16 MAJOR (one root cause) applied content leaves context.contentsModel stale, so the next save raises the conflict dialog (watcher.ts:260-300) - CONFIRMED by trace: Context.contentsModel is a getter over the private _contentsModel (context.js:146), refreshed only by _populate/_save/_updateContentsModel; _maybeSave (context.js:646-683) compares its hash against disk and raises the conflict. Material: the input universe names the editor open beside the preview, and Revert discards the edit. DEFERRED for a decision, not for budget: ACC-APPLY-9's mechanism note (docs/acc-crit-advanced-markdown-viewer.md:57) already records this UNRESOLVED with three options (save-after-merge violates 'never writes to disk'; patching pins the private Context._updateContentsModel(full), one line after _apply at watcher.ts:272; accepting the dialog changes the bar and the criterion). The Star Colonel chooses. Stays live: false 'File Changed' dialog on the first save after an applied external change.", "F15 MAJOR scroll restore defeats itself: _restoring is toggled synchronously while scroll events dispatch asynchronously, so the controller's own rAF restore sets _userScrolledDuringRestore and the 150 ms late restore never runs; the TOC-fix sibling's smooth scroll to the hash wins on every render (controller.ts:214-224, :319-337; sibling index.ts:187-198 confirmed) - CONFIRMED (CSSOM: scroll events are dispatched in the rendering steps, never synchronously on scrollTop assignment). DEFERRED by budget: fourth-ranked MAJOR, and the in-repo change (set _userScrolledDuringRestore = true from _onAttention, delete the dead _restoring flag) is net deletion but is terminal only together with the sibling change ACC-COMPAT-37 (scroll only when the hash changed), which needs the Star Colonel's word per change. First candidate next round. Stays live: a reader with a URL hash and the TOC fix installed loses their place on every external write.", "F9 MAJOR blocked cue cleared by the first wheel tick or click while the block persists, never re-established because _record(full) precedes the dirty check so 'dirty' is emitted once per write (controller.ts:206-208, watcher.ts:260-269) - CONFIRMED by reading. DEFERRED by budget; remedy is one early return in _onAttention when TAB_BLOCKED_CLASS is present (the fade callback needs nothing: it only runs after an apply, which already replaces the class). Residual named by the reviewer: after an Overwrite save the dot stays until the next external write; clearing it on saveState is a new signal path and stays deferred. Stays live: the blocked cue holds for one interaction only.", "F17 MINOR decorations inside SVG <text> make a changed mermaid label vanish for the fade window (highlight.ts:64-77) - CONFIRMED by the reviewer's jsdom and headless Chrome test; self-healing after fadeDuration + 300 ms. DEFERRED: one namespace rejection in captureText's filter is a new branch, and MINOR does not admit a new mechanism this round. Stays live: a changed diagram label is unpainted for about 4.3 s.", "F10 MINOR word-replacement ghost glued to its replacement (highlight.ts:255) - CONFIRMED. DEFERRED: the remedy adds a box-model property (margin-inline-end) that the stylesheet header forbids; change 2 (ghost fades to invisible) changes how the fused run reads, so judge again after it lands. Stays live: 'applesoranges' with strike-through on the first word.", "F15 MAJOR scroll restore defeats itself (controller.ts:214-224, :319-337): still CONFIRMED, still DEFERRED, same reason as round 1 - the in-repo half (set _userScrolledDuringRestore = true from _onAttention, delete the dead _restoring flag) is net deletion but terminal only with the sibling change ACC-COMPAT-37, which needs the Star Colonel's word. New fact this round: the TOC-fix sibling scrolls smoothly at setTimeout 100 ms after rendered (../jupyterlab_markdown_viewer_toc_fix/src/index.ts:195-197) and the late restore fires at 150 ms, so the in-repo half alone would interrupt the sibling's smooth scroll 50 ms in: the reader keeps their place but sees a jump toward the heading and back on every write, which the next round would file as a new defect. Action for the caller: obtain the Star Colonel's word on the sibling change (TOC fix scrolls only when the hash changed) so the next round applies both halves together. Stays live: a reader with a URL hash and the TOC fix installed loses their place on every external write.", "F9 MAJOR blocked cue cleared by the first wheel tick or click while the block persists (controller.ts:206-208, watcher.ts:260-269): still CONFIRMED, DEFERRED within budget with a reason. The one-line early return in _onAttention when TAB_BLOCKED_CLASS is present is non-terminal: it leaves the cue with no dismissal path after an Overwrite save until the next external write (the residual the round-1 reviewer named), and the next round would file that and ask for a clear-on-clean signal. The terminal remedy is that signal - clear TAB_BLOCKED_CLASS when context.model.stateChanged reports dirty -> false, together with the early return - which is a new signal path and a decision on when the blocked cue ends, a point the bar does not state. Ask the Star Colonel: should the blocked cue end when the document becomes clean (save or revert)? Plan the terminal remedy on a yes. Stays live: the blocked cue holds for one interaction only, until the next external write re-emits it.", "F1/F16 MAJOR applied content leaves context.contentsModel stale so the next save raises the conflict dialog (watcher.ts:260-300): DEFERRED for the Star Colonel's decision among the three options recorded at docs/acc-crit-advanced-markdown-viewer.md:57 (ACC-APPLY-9); no new evidence this round. Stays live: a false 'File Changed' dialog on the first save after an applied external change.", "F17 MINOR decorations inside SVG <text> unpaint a changed mermaid label for the fade window (highlight.ts:64-77): DEFERRED, MINOR does not admit the new namespace-rejection branch. Stays live: a changed diagram label is unpainted for about 4.3 s.", "F10 MINOR word-replacement ghost glued to its replacement (highlight.ts:255): DEFERRED; judge again after the round-1 F7 ghost-out keyframe has been seen in a browser, since it changes how the fused run reads. Stays live: 'applesoranges' with strike-through on the first word.", "F15 MAJOR scroll restore defeats itself (controller.ts:214-224, :319-337): still CONFIRMED (verified again this round: _restoring is set and cleared synchronously around the scrollTop assignment at :332-334 while the scroll event dispatches later, so _onScroll at :219 never sees it), still DEFERRED for the same reason as rounds 1 and 2 - the in-repo half is terminal only together with the sibling change ACC-COMPAT-37 (TOC fix scrolls only when the hash changed), which needs the Star Colonel's word per change; the in-repo half alone interrupts the sibling's smooth scroll 50 ms in and would be filed as a new defect. Action for the caller unchanged: obtain that word so both halves land together. Stays live: a reader with a URL hash and the TOC fix installed loses their place on every external write.", "F9 MAJOR blocked cue cleared by the first wheel tick or click while the block persists (controller.ts:206-208, :252-259; watcher.ts:260-269): still CONFIRMED, still DEFERRED pending the Star Colonel's answer to the round-2 question - should the blocked cue end when the document becomes clean (save or revert)? On a yes, plan the terminal remedy (early return in _onAttention when TAB_BLOCKED_CLASS is present, plus clearing it on context.model.stateChanged dirty -> false). Stays live: the blocked cue holds for one interaction only, until the next external write re-emits it.", "F1/F16 MAJOR applied content leaves context.contentsModel stale so the next save raises the conflict dialog (watcher.ts:260-300): DEFERRED for the Star Colonel's decision among the three options at docs/acc-crit-advanced-markdown-viewer.md:57 (ACC-APPLY-9); no new evidence. Stays live: a false 'File Changed' dialog on the first save after an applied external change.", "F17 MINOR decorations inside SVG <text> unpaint a changed mermaid label for the fade window (highlight.ts:64-77): DEFERRED, MINOR does not admit the namespace-rejection branch. Stays live: a changed diagram label is unpainted for about 4.3 s.", "F10 MINOR word-replacement ghost glued to its replacement (highlight.ts:255): DEFERRED; judge after the ghost-out keyframe has been seen in a browser. Stays live: 'applesoranges' with strike-through on the first word.", "Finding 3 residual (not a defect, recorded so the next round does not re-derive it): restricting the 0ms fade-in override to spans that overlap the previous decoration set, so text a held write newly adds keeps its 300 ms fade-in. Needs a mapping of added ranges between successive snapshots; deferred as not earned by any reader harm.", "Finding 3 MINOR (src/controller.ts:291-303 - the held boolean sets --jp-AdvancedMd-fade-in 0ms on every span, so text a held write adds for the first time appears at full tint instead of ramping 300 ms): CONFIRMED by reading - held is one boolean, decorate() returns spans for every range in ranges.added, and because the baseline is held (:312) ranges.added covers text tinted by the earlier write and text the new write introduces alike; controller.spec.ts:113 pins the blanket '0ms'. This is the exact residual the round-3 ruling recorded ('restricting the 0ms fade-in override to spans that overlap the previous decoration set ... deferred as not earned by any reader harm'); the reviewer's trace uses the same fixture and brings no new evidence, so the deferral stands. Revert tested and rejected: deleting the round-3 held branch (net deletion of :288-291, :299-303 and the spec assertion) dissolves Findings 2 and 3 and the HILITE-21 half of Finding 1, but re-opens round-3 Finding 3 on a larger painted area - the whole held region (everything tinted since the last completed fade) drops to transparent and ramps back over 300 ms on every write in a burst, where the current behaviour makes only the newly added text pop; the revert is not smaller in reader harm and no more terminal. Refinement rejected: the proposed textContent Set is a new mechanism, MINOR does not admit one, and containment by textContent misidentifies repeated words as re-created, which the next round would file. The two behaviours are contested semantics at one loop-introduced site: steady held region with a pop on new text (current), or a 300 ms ramp on every span with a strobe of the held region (revert); both at once need a mapping of added ranges between successive snapshots. Ask the Star Colonel which behaviour the product wants on a burst of writes faster than the fade; only a request for both earns the range-mapping mechanism. Stays live: in a burst at 1-2 s intervals, additions after the first appear without the 300 ms ramp.", "F15 MAJOR scroll restore defeats itself (controller.ts:214-224, :335-353): still CONFIRMED (verified again this round: _restoring is set and cleared synchronously around the scrollTop assignment at :341-343 while the scroll event dispatches later), still DEFERRED for the same reason as rounds 1-3 - the in-repo half is terminal only together with the sibling change ACC-COMPAT-37 (TOC fix scrolls only when the hash changed), which needs the Star Colonel's word per change; the in-repo half alone interrupts the sibling's smooth scroll 50 ms in. Action for the caller unchanged: obtain that word so both halves land together. Stays live: a reader with a URL hash and the TOC fix installed loses their place on every external write.", "F9 MAJOR blocked cue cleared by the first wheel tick or click while the block persists (controller.ts:206-208, :252-259; watcher.ts:260-269): still CONFIRMED, still DEFERRED pending the Star Colonel's answer to the round-2 question - should the blocked cue end when the document becomes clean (save or revert)? On a yes, plan the terminal remedy (early return in _onAttention when TAB_BLOCKED_CLASS is present, plus clearing it on context.model.stateChanged dirty -> false). Stays live: the blocked cue holds for one interaction only, until the next external write re-emits it.", "F1/F16 MAJOR applied content leaves context.contentsModel stale so the next save raises the conflict dialog (watcher.ts:260-300): DEFERRED for the Star Colonel's decision among the three options at docs/acc-crit-advanced-markdown-viewer.md:57 (ACC-APPLY-9); no new evidence. Stays live: a false 'File Changed' dialog on the first save after an applied external change.", "F17 MINOR decorations inside SVG <text> unpaint a changed mermaid label for the fade window (highlight.ts:64-77): DEFERRED, MINOR does not admit the namespace-rejection branch. Stays live: a changed diagram label is unpainted for about 4.3 s.", "F10 MINOR word-replacement ghost glued to its replacement (highlight.ts:255): DEFERRED; judge after the ghost-out keyframe has been seen in a browser. Stays live: 'applesoranges' with strike-through on the first word.", "F15 MAJOR scroll restore defeats itself (src/controller.ts:214-224, :335-353): still CONFIRMED (verified again: _restoring set and cleared synchronously around scrollTop at :341-343 while the scroll event dispatches later), still DEFERRED - the in-repo half is terminal only with the sibling change ACC-COMPAT-37 (TOC fix scrolls only when the hash changed), which needs the Star Colonel's word. Stays live: a reader with a URL hash and the TOC fix installed loses their place on every external write.", "F9 MAJOR blocked cue cleared by the first wheel tick or click while the block persists (src/controller.ts:206-208, :252-259; src/watcher.ts:260-269): still CONFIRMED, still DEFERRED pending the Star Colonel's answer - should the blocked cue end when the document becomes clean? On a yes, plan the early return in _onAttention when TAB_BLOCKED_CLASS is present plus clearing it on context.model.stateChanged dirty -> false. Stays live: the blocked cue holds for one interaction only.", "F1/F16 MAJOR applied content leaves context.contentsModel stale so the next save raises the conflict dialog (src/watcher.ts:260-300): DEFERRED for the Star Colonel's decision among the three options at docs/acc-crit-advanced-markdown-viewer.md:57 (ACC-APPLY-9); no new evidence. Stays live: a false 'File Changed' dialog on the first save after an applied external change.", "Round-4 Finding 3 MINOR (src/controller.ts:291-303 held skips the fade-in for text a held write newly adds; this round's Finding 1 is the same defect): DEFERRED pending the Star Colonel's choice of burst-fade semantics; only a request for both behaviours earns the range-mapping mechanism. Stays live: in a burst at 1-2 s intervals, additions after the first appear without the 300 ms ramp.", "F17 MINOR decorations inside SVG <text> unpaint a changed mermaid label for the fade window (src/highlight.ts:64-77): DEFERRED, MINOR does not admit the namespace-rejection branch. Stays live: a changed diagram label is unpainted for about 4.3 s.", "F10 MINOR word-replacement ghost glued to its replacement (src/highlight.ts:255): DEFERRED; judge after the ghost-out keyframe has been seen in a browser. Stays live: 'applesoranges' with strike-through on the first word.", "Finding 4 MINOR (src/highlight.ts:394-398 isFreshRemoval matches on offset only, so a ghost already on screen re-fades from transparent when the same position is replaced twice within one fade): CONFIRMED by reading; material but cosmetic - one ghost dips for 300 ms once in a double correction inside the 4 s window. DEFERRED, not planned: (a) the proposed text-equality condition is not terminal - when the cumulative diff (baseline vs now) and the fresh diff (previous render vs now) chunk a removal differently at the same offset (baseline 'x y z' -> 'x z' -> 'z': cumulative removal 'x y ' at 0, fresh removal 'x ' at 0), the ghost is part held and part new, and the text check flips it from a fresh blink to a full-tint pop; that is the same pop-versus-strobe contested semantics recorded at round-4 Finding 3, now inside DEF-HILITE-9; (b) this would be the fifth consecutive refinement of the loop-introduced held-highlight mechanism, and budget goes to the two MAJORs. Judge again after the Star Colonel has seen the round-5 fresh-range mapping in a browser; if a change is then wanted, the one-condition remedy `other.at === removal.at && other.text === removal.text` is the candidate and highlight.spec.ts's held-ghost case (identical text) does not constrain it. Stays live: a struck word replaced a second time within the fade dips to transparent and back over 300 ms.", "Round-4 Finding 3 MINOR (burst-fade semantics inside DEF-HILITE-9's fresh-range mapping): DEFERRED pending the Star Colonel's choice after seeing the round-5 mapping in a browser; no new evidence this round. Stays live: in a burst at 1-2 s intervals, a ghost or slice the cumulative and fresh diffs chunk differently may pop or dip once.", "Round-6 Finding 4 MINOR (src/highlight.ts isFreshRemoval matches on offset only): DEFERRED, same reason as round 6 - the text-equality condition is not terminal where cumulative and fresh diffs chunk a removal differently at one offset, and it would be a further refinement of the loop-introduced held-highlight mechanism. Candidate if the Star Colonel wants it after a browser look: `other.at === removal.at && other.text === removal.text`. Stays live: a struck word replaced a second time within the fade dips to transparent and back over 300 ms.", "F10 MINOR word-replacement ghost glued to its replacement (src/highlight.ts): DEFERRED; DEF-HILITE-6's jp-AdvancedMd-gap ::after answers the strike-across case, judge the remaining fused-run reading after the ghost-out keyframe has been seen in a browser. Stays live: a struck word may read as fused with its replacement when neither side ends in a word.", "Cleanup pass (not a defect, one entry so the next round does not re-derive it): F3 dead weight, highlight.ts:226-229 comment reword, FADE_IN_MS comment extension, and this round's watcher.ts hash-cast deletion are all net-deletion or comment-only edits held for a single pass the Star Colonel orders, outside this loop.", "Round-6 Finding 4 MINOR (src/highlight.ts:396 isFreshRemoval matches on offset only): DEFERRED, same reason as rounds 6 and 7 - the text-equality condition is not terminal where cumulative and fresh diffs chunk a removal differently at one offset, and it would be a further refinement of the loop-introduced held-highlight mechanism. Candidate if the Star Colonel wants it after a browser look: `other.at === removal.at && other.text === removal.text`. Stays live: a struck word replaced a second time within the fade dips to transparent and back over 300 ms.", "Round-4 Finding 3 MINOR (burst-fade semantics inside DEF-HILITE-9's fresh-range mapping; this round's Finding 2 is a further instance where a foreign render resets the fresh baseline): DEFERRED pending the Star Colonel's choice after seeing the round-5 mapping in a browser; no new evidence of reader harm this round. Stays live: in a burst at 1-2 s intervals, a slice or ghost the cumulative and fresh diffs chunk differently may pop or dip once.", "F10 MINOR word-replacement ghost glued to its replacement (src/highlight.ts): DEFERRED; DEF-HILITE-6's jp-AdvancedMd-gap ::after answers the strike-across case, judge the remaining fused-run reading after the ghost-out keyframe has been seen in a browser. Stays live: a struck word may read as fused with its replacement when neither side ends in a word.", "Cleanup pass (not a defect, one entry so the next round does not re-derive it): F3 dead weight, highlight.ts:226-229 comment reword (superseded for the removal-loop comment by this round's change), FADE_IN_MS comment extension, round-7 watcher.ts hash-cast deletion, and this round's base.css:17 mirror comment are net-deletion or comment-only edits held for a single pass the Star Colonel orders, outside this loop.", "pm-tools pass (documentation drift, outside this loop, on the Star Colonel's order): ACC-HILITE-21/23/25 wording per the round-4 note; ACC-HILITE-20 ghost bound stated as 'the diff's coarse branch, recognised by either side exceeding 1000 tokens' once this round's change lands; docs/defects.md:75 'warns once per open document'."], "refuted": ["F3 MINOR dead weight (highlight.ts:324 etc.) - IMMATERIAL: no reader on any path is harmed; maintenance surface only. Claims verified true by reading (hasVisibleChange cannot be false after the previous !== snapshot.text guard; refresh(), get widget(), the type re-export and the decoration skip in captureText have no live caller). Left for a cleanup pass the Star Colonel orders, not this loop.", "F4 MINOR configuration plane split (controller.ts:52, base.css:15-16, index.ts:41-64) - IMMATERIAL: values agree today; drift risk only. Verified: base.css:15 --jp-AdvancedMd-fade-duration is dead because highlight.ts:118 always sets it inline.", "F5 and F12 MINOR backoff never engages / hash comparison dies after the first apply (watcher.ts:103, :225-228, :246-254) - one root cause (both catch blocks resolve, so Lumino Poll never enters its rejected phase). IMMATERIAL against the bar: a missing file or a down server is not on the reader's path; last_modified comparison detects every rewrite in the input universe. Verified by reading. The bar's DEGRADE sentence ('backs off up to 60 s'), ACC-DETECT-6 ('polling stops') and the code disagree three ways - that is a spec alignment for pm-tools, not a code change this round.", "F6 MINOR acceptance criteria and defect log advertise out-of-scope criteria and leave fixed defects open - IMMATERIAL documentation drift; goes through pm-tools when the Star Colonel orders it.", "F13 MINOR poll interval in seconds beside fade duration in milliseconds (schema/plugin.json) - IMMATERIAL: harms a user configuring, not a reader reading. Note for the caller: the reviewer's own remedy says to wait for the first release, but before the first release is the cheap moment to change the unit; that is a product decision, not a defect.", "F14 MINOR hard-coded colours instead of theme tokens - IMMATERIAL and taste; contrast measured above 7:1 in both themes per the reviewer. Declined.", "F11 MINOR removed blocks lose their structure (white-space: pre-line) - taste=true by the reviewer's own flag; inherent to the inline-ghost constraint edit-at-content imposes. Declined: pre-line inside a <p> makes the ghost taller and enlarges the reflow change 2 is reducing.", "Finding 3 (MINOR, outOfBar, material=false): ACC-HILITE-25 at docs/acc-crit-advanced-markdown-viewer.md:139-140 specifies per-change independent fade timers, contradicting the applied one-timer cumulative design at controller.ts:349-364, and ACC-HILITE-20 (:118) carries no ghost size bound. CONFIRMED as documentation drift, REFUTED as immaterial: no reader on the primary path is harmed. Same disposition as F6 in round 1: the criteria are written only through pm-tools on the Star Colonel's order. Note for the caller: when that pass runs, ACC-HILITE-25 should read 'one highlight group held against the last completed fade, fade timer restarted per write, decorations removed fadeDuration after the last write', and ACC-HILITE-20 should state the ghost bound as 1000 tokens (the diff's coarse bound) once change 2 lands.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14 stand; this round brought no new evidence on any of them.", "Finding 1 MINOR outOfBar (docs/acc-crit-advanced-markdown-viewer.md:131, :139-140 - ACC-HILITE-23 and ACC-HILITE-25 advertise per-change fade timers the F2 closure replaced with one held timer): CONFIRMED as documentation drift by reading the criteria against controller.ts:299-305 and :351-366; REFUTED as immaterial - identical to round-2 Finding 3, no new evidence; no reader on the primary path is harmed. The criteria are written only through pm-tools on the Star Colonel's order. Note for that pass (supersedes the round-2 wording note): ACC-HILITE-25 to 'a second external change during a fade joins the held highlight and the whole highlight fades fadeDuration after the last change', test 'two rewrites 1 s apart, assert one highlight group covering both changes still visible 4 s after the second'; ACC-HILITE-23 'and their remaining fade time' to 'and restarts the fade'. Per-group timers are NOT to be implemented - that decision is locked since round 1.", "Finding 2 MINOR outOfBar (src/highlight.ts:232 ghost skip bound matches the coarse branch on the before side only; bound raised from 1000 characters to 1000 tokens in round 2): CONFIRMED by reading - diff.ts:138-141 goes coarse when either side exceeds MAX_LCS_TOKENS, highlight.ts:232 tests only the removal's own token count, so a 600-token body replaced wholesale by a 1500-token body shows a 600-token ghost. REFUTED as immaterial: a removal of at most 1000 tokens shown inline is exactly what the primary path promises ('text it removed is shown inline'), it is the same ghost a 900-token LCS-branch replacement produces, and the round-1 F7 ghost-out keyframe (base.css:43-47, :61-66) fades it to opacity 0 before removal so the reflow the comment at highlight.ts:226-229 worries about happens on an invisible element. The comment itself states only that a removal past the bound is not shown, which is true; the overclaim of parity lives in the round-2 change summary, not in code. No change: a comment reword would spend a change slot and add review surface for a defect no reader meets. Recorded for the cleanup pass the Star Colonel orders (with F3): reword highlight.ts:226-229 to 'A removal longer than the diff's token bound is not shown' if that pass runs. The 1000-character versus 1000-token choice was decided in round 2 and this round brings no evidence a 3000-character fading ghost harms a reader.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14 and round-2 Finding 3 stand; this round brought no new evidence on any of them.", "Finding 1 MINOR outOfBar (docs/acc-crit-advanced-markdown-viewer.md:123, :131, :139-140 - ACC-HILITE-21/23/25 describe per-span 300 ms fade-in and per-change fade timers): CONFIRMED as documentation drift by reading the criteria against src/controller.ts:291-304 (held spans get --jp-AdvancedMd-fade-in 0ms) and :360-375 (one restarted timer). REFUTED as immaterial: no reader on the primary path is harmed; identical disposition to round-2 Finding 3 and round-3 Finding 1, the only new element being HILITE-21, which the round-3 change contradicts for held spans. The criteria are written only through pm-tools on the Star Colonel's order. Wording note for that pass (supersedes the round-3 note): ACC-HILITE-21 'a highlight fades in over 300 ms unless it re-creates a still-tinted region, which appears at full tint'; ACC-HILITE-23 'keeps the highlights and restarts the fade'; ACC-HILITE-25 'a second external change during a fade joins the held highlight and the whole highlight fades fadeDuration after the last change', test 'two rewrites 1 s apart, assert one highlight group covering both changes still visible 4 s after the second'.", "Finding 2 MINOR outOfBar (src/controller.ts:49-52 FADE_IN_MS comment 'Matches the stylesheet'; timer at :374 overshoots the animation by 300 ms on held spans): CONFIRMED by reading - style/base.css:28-31 delays jp-AdvancedMd-fade-out by var(--jp-AdvancedMd-fade-in), so with 0ms the animation ends at fadeDuration while the undecorate fires at fadeDuration + 300; base.css:27-31 'forwards' holds background-color transparent and base.css:61-66 ghost-out holds opacity 0, so the element is invisible for the 300 ms. REFUTED as immaterial: nothing is painted during the overshoot on any input in the universe; the comment is maintainer-facing. No change: a comment reword spends a change slot for a defect no reader meets. Recorded for the cleanup pass the Star Colonel orders (with F3 and the highlight.ts:226-229 reword): extend the FADE_IN_MS comment with 'held spans set it to 0 in _onRendered, so the timer then trails the animation by this much on an already-transparent element'.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14, round-2 Finding 3, round-3 Finding 1 and round-3 Finding 2 stand; this round brought no new evidence on any of them.", "Finding 1 MINOR outOfBar (src/controller.ts:291, :299-303 - held sets --jp-AdvancedMd-fade-in 0ms on every span, including spans in regions never tinted): CONFIRMED by reading - held is one boolean and the loop covers all of this._decorations. REFUTED as immaterial: identical root cause and disposition to round-4 Finding 3 (deferred as contested semantics awaiting the Star Colonel's choice between a steady held region with a pop on new text and a 300 ms ramp with a strobe of the held region); the second-paragraph fixture is a new reproduction, not new evidence of reader harm - no information is lost, no flash occurs, undecorate output is unchanged. Revert of the round-3 mechanism re-tested and rejected on the round-4 evidence: it reopens the whole-region strobe on every write in a 1-2 s burst, which is inside the input universe and violates the primary path's 'hold'. The per-range mapping remains the only construct satisfying both clauses and is earned only by the Star Colonel asking for both behaviours.", "Finding 2 MINOR outOfBar (src/controller.ts:156-158 updateSettings calls _clearDecorations, which at :377-383 never clears _fadeTimer; only dispose :169-172 and the fade callback :365 do): CONFIRMED by reading. REFUTED as immaterial: the sequence needs a highlight or enabled toggle inside one 4.3 s fade window, which no reader on the primary path performs; the orphaned timer fires, recaptures the text and advances the baseline at :369, so the only effect is one skipped 300 ms fade-in on the following write. No change: the rule that an unharmed finding earns a refutation, not a fix, applies, and a second clean round closes the loop. Recorded for the cleanup pass the Star Colonel orders (with F3, the highlight.ts:226-229 reword and the FADE_IN_MS comment): move the four-line fade-timer clear from dispose into _clearDecorations, placed BEFORE the empty-decorations early return at :378-380 so a pending timer is cleared even when the decoration list is already empty; the fade callback nulls the field before calling, _onRendered re-arms via _scheduleFade, so no other caller changes behaviour.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14, round-2 Finding 3, round-3 Findings 1 and 2, round-4 Findings 1 and 2 stand; this round brought no new evidence on any of them.", "Finding 2 MINOR outOfBar (src/watcher.ts:370-371, :392 - _syncWarned is per FileWatcher instance, so the warning is once per open document, not once per session as the round-5 closure and docs/defects.md:75 state): CONFIRMED by reading, REFUTED as immaterial - the branch is reached only when a JupyterLab release removes the private Context._updateContentsModel, which 4.6.3 has; no reader on the primary path sees it. No code change: a module-scope flag is a new shared state for a maintainer-facing message. Note for the pm-tools pass the Star Colonel orders: reword docs/defects.md:75 to 'warns once per open document'.", "Finding 5 MINOR outOfBar (src/controller.ts:435, style/base.css:106-108 - the blocked marker persists with no caption or tooltip): REFUTED as immaterial by the reviewer's own materiality ('NONE beyond momentary confusion') and by the bar - the primary path names the File Changed dialog on save as where the situation is explained, and DEF-CUE-5's persistence is what round 2 asked the Star Colonel for. A tooltip through widget.title.caption is a new mechanism that DocumentWidgetManager.setCaption rewrites on every fileChanged emit, so it would need its own re-apply path; whether the dot should carry text is a product decision for the Star Colonel, not a defect. Nothing at risk stays live.", "Finding 6 MINOR outOfBar (src/controller.ts:130-132, :237 - a scrollbar thumb drag longer than 500 ms or touch momentum overlapping the 150 ms late-restore window is snapped back for one frame): CONFIRMED as a reading of the code, REFUTED as immaterial - the bar's reader scrolls by wheel and key, both of which stamp _lastInputAt on every tick; a thumb drag past 500 ms coinciding with a render's 150 ms window yields one frame of displacement that the next pointer move corrects, and a tablet flick is outside the input universe. A pointermove/touchmove listener is a new mechanism a MINOR does not admit.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14, round-2 Finding 3, round-3 Findings 1 and 2, round-4 Findings 1 and 2, round-5 Findings 1 and 2 stand; this round brought no new evidence on any of them. Round-5 applied DEF-APPLY-3, DEF-APPLY-4, DEF-CUE-5, DEF-HILITE-6/7/8/9 close the standing deferrals F15, F1/F16, F9, F10, F17 and the round-4/5 held-fade-in and fade-timer findings; none of those remains deferred.", "Finding 1 MINOR outOfBar (src/watcher.ts:208, :246-247, :257, :276-277 - hash option cast to any with eslint-disable and structural casts on the read side, although @jupyterlab/services 7.6.3 types both): CONFIRMED by reading - node_modules/@jupyterlab/services/lib/contents/index.d.ts:146 declares Contents.IFetchOptions.hash?: boolean, :88 declares Contents.IModel.hash?: string, and get(path, options?: Contents.IFetchOptions) at :666 accepts the typed literal; watcher.spec.ts:96-99 already types the option. REFUTED as immaterial: compiles and runs identically, no reader on the primary path is touched. Revert of the round-6 content-read change rejected: the stat-read cast at :246-247 and the two structural casts predate it, so the finding would survive, and the material round-6 gap (null hash handed to the Context) would re-open. Recorded for the cleanup pass the Star Colonel orders (with F3, the highlight.ts:226-229 reword and the FADE_IN_MS comment): write `hash: true` in both option objects, read `stat.hash ?? null` at :257 and `model?.hash ?? null` at :208, delete the two eslint-disable comments - net deletion, no behaviour change.", "Finding 2 MINOR outOfBar (src/controller.ts:362 - the narrowed early return `target <= 0 && this._lastInputAt === 0` lets the 150 ms late pass revert first-render URL-hash navigation when the reader acted in the preview more than 500 ms before its first render): CONFIRMED as a trace by reading :362, :237 and :383-386. Narrowing fact the reviewer did not cite: _restoreScroll also returns early for FOREIGN_SCROLL_GUARD_MS (3000 ms, :59) after noteActivated (:153-155, :365), so the case additionally needs the first render to complete more than 3 s after the tab was activated. REFUTED as immaterial: the primary path is a rewrite of an already-rendered document, where the round-6 behaviour (a reader who scrolled back to the top stays there) is what the bar requires; files of a few thousand lines render inside both windows. Revert of the round-6 early-return change rejected: it re-opens round-6 finding 3, which was on the primary path ('keep the reader's place'). A first-render flag is a new mechanism a MINOR does not admit; the reviewer's own remedy is to defer, and with no reader harm the disposition is refutation.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14, round-2 Finding 3, round-3 Findings 1 and 2, round-4 Findings 1 and 2, round-5 Findings 1 and 2, round-6 Findings 2, 5 and 6 stand; this round brought no new evidence on any of them.", "Finding 1 MINOR outOfBar (src/controller.ts:52 FADE_IN_MS duplicated with style/base.css:17 --jp-AdvancedMd-fade-in): CONFIRMED by reading - both read 300 and _scheduleFade at :402 removes decorations at fadeDuration + FADE_IN_MS while base.css:29-32 ends the fade-out at fade-duration + var(--jp-AdvancedMd-fade-in). REFUTED as immaterial: the values agree in the shipped build, no reader on the primary path is harmed; same disposition as round-4 Finding 2 on the same constant, no new evidence. Reading the custom property at runtime is a new mechanism a MINOR does not admit. Recorded for the cleanup pass the Star Colonel orders: add the mirror comment at base.css:17 ('matches FADE_IN_MS in controller.ts').", "Finding 2 MINOR outOfBar (src/controller.ts:305-314, :323-326 - a render the watcher did not cause during a pending fade leaves no decorations on screen and advances _lastRendered, so the next write inside the fade recreates the earlier write's text with --jp-AdvancedMd-fade-in 0ms): CONFIRMED by reading - _lastRendered advances on every render (:305-306), shouldDecorate is false with _pending false, _fadeTimer and _previousText are held, and fresh = diff(_lastRendered, now) then excludes the earlier write. REFUTED as immaterial by the reviewer's own materiality and the bar: it needs a render caused by neither the external writer nor the reader inside one 4.3 s window; the highlight is still shown and still fades, only the 300 ms ramp of the earlier part is skipped once. With the editor open, the reader's typing causes such a render but dirties the document, so the second write is held back by the watcher and lands only after a save, usually after the fade has ended. No change: a branch that re-decorates on a foreign render or resets _lastRendered is a new mechanism a MINOR does not admit. This is the third MINOR filed inside DEF-HILITE-9 (round-6 Finding 4, round-8 Finding 2); none has been refined, and a revert of DEF-HILITE-9 is rejected because it re-opens the round-3 whole-region strobe on bursts, which is on the primary path.", "Finding 3 MINOR (src/controller.ts:237 - a scrollbar-thumb drag or touch pan across a render is dropped by the 500 ms input window and the 150 ms late pass snaps the view back; a TOC side-panel click inside the 150 ms window is undone): CONFIRMED as a reading of the code, identical mechanism to round-6 Finding 6; the jsdom probe reproduces the mechanism round 6 already confirmed and is not new evidence of reader harm. REFUTED as immaterial against the bar, as in round 6: the reader's scroll by wheel and key stamps _lastInputAt on every tick; a thumb drag longer than 500 ms that overlaps a render's 150 ms window yields a displacement the next pointer move corrects (the reviewer's own rating: perceptible, recoverable, brief), a touch flick is outside the input universe, and a TOC-panel click landing in the 150 ms window after an external write is rare. The remedy is a pointer-held flag with pointerup/pointercancel listeners on document, a new mechanism a MINOR does not admit; the TOC-panel case needs a second document-level listener the reviewer defers themselves. Note for the caller: whether thumb-drag scrolling is inside the input universe is the Star Colonel's call; on a yes, the pointer-held flag (set on the existing pointerdown listener, cleared on document pointerup/pointercancel, tested in _onScroll before the 500 ms window) is the candidate and the reviewer's probe sequence is its fixture.", "Prior refutations F3, F4, F5/F12, F6, F11, F13, F14, round-2 Finding 3, round-3 Findings 1 and 2, round-4 Findings 1 and 2, round-5 Findings 1 and 2, round-6 Findings 2, 5 and 6, round-7 Findings 1 and 2 stand; this round brought no new evidence on any of them."], "rulings": [{"round": 1, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 3, "reverts": 0, "fanout": "0/17", "trajectory": "converging"}, {"round": 2, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 2, "reverts": 0, "fanout": "3/3", "trajectory": "converging"}, {"round": 3, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 1, "reverts": 0, "fanout": "3/3", "trajectory": "converging"}, {"round": 4, "ruling": "PROCEED", "changes": 0, "reverts": 0, "fanout": "3/3", "trajectory": "converging"}, {"round": 5, "ruling": "PROCEED", "changes": 0, "reverts": 0, "fanout": "2/2", "trajectory": "converging"}, {"round": 6, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 2, "reverts": 0, "fanout": "6/6", "trajectory": "converging"}, {"round": 7, "ruling": "PROCEED", "changes": 0, "reverts": 0, "fanout": "2/2", "trajectory": "converging"}, {"round": 8, "ruling": "PROCEED_WITH_DEFERRALS", "changes": 1, "reverts": 0, "fanout": "3/4", "trajectory": "converging"}], "closures": [{"round": 1, "site": "src/controller.ts _onRendered and the _scheduleFade callback", "summary": "F2: the diff baseline _previousText is advanced only when no fade timer is pending, and the fade callback recaptures the rendered text after _clearDecorations, so writes arriving faster than the fade are highlighted cumulatively against the last completed fade and the highlight holds fadeDuration after the last write", "files": ["src/controller.ts"]}, {"round": 1, "site": "style/base.css .jp-AdvancedMd-removed and @keyframes jp-AdvancedMd-ghost-out", "summary": "F7: removed-text ghosts get their own exit keyframe animating background-color and opacity to transparent, set via animation-name on .jp-AdvancedMd-removed after the shared decoration rule; the added keyframe and the reduced-motion branch are unchanged", "files": ["style/base.css"]}, {"round": 1, "site": "src/highlight.ts MAX_GHOST_CHARS and the removal loop in decorate; src/__tests__/highlight.spec.ts", "summary": "F8: a removal longer than MAX_GHOST_CHARS (1000 characters, the coarse-diff branch of diff.ts) is skipped in decorate so a wholesale rewrite produces the added-text wash and the tab cue but no document-sized ghost; diff.ts is unchanged; unit test 'shows no ghost for a removal longer than the bound' added, 37/37 pass", "files": ["src/highlight.ts", "src/__tests__/highlight.spec.ts"]}, {"round": 2, "site": "src/controller.ts _onRendered baseline advance; src/__tests__/controller.spec.ts", "summary": "round 2 F2: the 'if (this._fadeTimer === null) _previousText = snapshot.text' block moved from before the decorate block to immediately before _restoreScroll(root), after decorate and _scheduleFade, so the timer this render started counts; new src/__tests__/controller.spec.ts (FileWatcher mocked, fake timers, fadeDuration 4000) pins alpha -> alpha beta [' beta'], +1 s alpha beta gamma [' beta gamma'], 0 decorations after 4300 ms, then alpha beta gamma delta [' delta']; 41/41 unit tests pass", "files": ["src/controller.ts", "src/__tests__/controller.spec.ts"]}, {"round": 2, "site": "src/highlight.ts removal loop in decorate; src/diff.ts exports; src/__tests__/highlight.spec.ts", "summary": "round 2 F8: MAX_GHOST_CHARS and its comment deleted; diff.ts now exports MAX_LCS_TOKENS and tokenize; decorate skips a removal whose tokenize(text).length exceeds MAX_LCS_TOKENS, one bound in one unit matching the diff's coarse branch; the comment above the loop states it; highlight.spec.ts test renamed 'shows no ghost for a removal past the diff token bound' with fixture 'old '.repeat(MAX_LCS_TOKENS / 2 + 1) and a token-count assertion", "files": ["src/highlight.ts", "src/diff.ts", "src/__tests__/highlight.spec.ts"]}, {"round": 3, "site": "src/controller.ts _onRendered inside the hasVisibleChange block; src/__tests__/controller.spec.ts", "summary": "round 3 Finding 3: `const held = this._fadeTimer !== null` recorded before _clearDecorations; after decorate and before _scheduleFade, when held, every new decoration element gets style.setProperty('--jp-AdvancedMd-fade-in', '0ms') so spans re-created while the region is already tinted appear at full tint and their fade-out restarts from full; the property lives on the span and leaves with it at undecorate; controller.spec.ts asserts the first-write span declares no such property and the second-write span declares '0ms'; 41/41 unit tests pass", "files": ["src/controller.ts", "src/__tests__/controller.spec.ts"]}, {"round": 5, "site": "DEF-APPLY-4 watcher.ts _syncContentsModel", "summary": "after each apply (and when a reload already brought the disk revision in) the watcher records the applied revision on the Context through its own private _updateContentsModel, so a following save from the editor compares equal against disk and raises no File Changed dialog; guarded by a unit test that loads the installed Context class and by a one-time runtime warning; a save over unsaved edits never reaches this path", "files": ["src/watcher.ts", "src/__tests__/watcher.spec.ts", "ui-tests/tests/live-view.spec.ts"]}, {"round": 5, "site": "DEF-CUE-5 watcher.ts pending change and unblocked signal; controller.ts _clearUpdatedCue", "summary": "a change found while the document is dirty is kept in the watcher (_pending), reported once, applied on a later poll once the document is clean, and let go with a new unblocked signal when a save from this session overwrote it or a reload brought it into the document; the controller clears only the updated marker on attention and on fade end, the blocked marker stays until unblocked or applied", "files": ["src/watcher.ts", "src/controller.ts", "src/__tests__/watcher.spec.ts", "src/__tests__/controller.spec.ts", "ui-tests/tests/live-view.spec.ts"]}, {"round": 5, "site": "DEF-APPLY-3 controller.ts _onScroll and _restoreScroll", "summary": "the controller's own restore is recognised by where it lands (_restoreTarget equals the scrollTop it assigned) instead of a flag around the assignment; while a restore is in flight a scroll event more than 500 ms after the last wheel, pointer or key event is another extension's and is neither recorded nor taken for the reader's, so the 150 ms late pass overrides the TOC fix's anchor scroll; _restoring removed", "files": ["src/controller.ts", "src/__tests__/controller.spec.ts", "ui-tests/tests/live-view.spec.ts"]}, {"round": 5, "site": "DEF-HILITE-6 highlight.ts needsGap, GAP_CLASS; base.css .jp-AdvancedMd-gap::after", "summary": "a removal ghost whose text ends in a word and whose following text starts with one gets class jp-AdvancedMd-gap, whose ::after is a non-breaking space displayed inline-block so the strike does not run across it; nothing is set on the ghost's own box", "files": ["src/highlight.ts", "style/base.css", "src/__tests__/highlight.spec.ts", "ui-tests/tests/live-view.spec.ts"]}, {"round": 5, "site": "DEF-HILITE-7 highlight.ts captureText", "summary": "text nodes whose parent element is in the SVG namespace are read past, so a diagram label is never wrapped in an HTML span; HTML inside a foreignObject is still read", "files": ["src/highlight.ts", "src/__tests__/highlight.spec.ts"]}, {"round": 5, "site": "DEF-HILITE-8 controller.ts _clearDecorations and _endFade", "summary": "_clearDecorations clears the fade timer together with the decorations; _endFade (used by the fade callback and by a settings change that turns highlight or the extension off) also advances the diff baseline to the text on screen, so the next change is diffed alone and fades in", "files": ["src/controller.ts", "src/__tests__/controller.spec.ts"]}, {"round": 5, "site": "DEF-HILITE-9 controller.ts fresh ranges; highlight.ts decorate fresh parameter", "summary": "during a pending fade the controller also diffs the previous render (_lastRendered) against this one and passes those fresh ranges to decorate; decorate cuts an added run where a fresh run starts or ends and gives the zero fade-in only to slices no fresh range overlaps and to ghosts whose offset no fresh removal matches; the per-render hold and the controller-side 0ms loop are gone", "files": ["src/controller.ts", "src/highlight.ts", "src/__tests__/controller.spec.ts", "src/__tests__/highlight.spec.ts"]}, {"round": 6, "site": "round 6 finding 1: watcher.ts _check content read", "summary": "the content read now asks the server for the hash (the same hash:true spread the stat read uses), so _record(full) stores the server's hash, _syncContentsModel hands the Context a non-null hash, and the next poll's moved test compares hashes; the watcher.spec.ts fixture now returns the hash only when the options ask for it, matching the server contract, and the apply test asserts hash h1 reached the Context", "files": ["src/watcher.ts", "src/__tests__/watcher.spec.ts"]}, {"round": 6, "site": "round 6 finding 3: controller.ts _restoreScroll early return", "summary": "the early return now reads `if (target <= 0 && this._lastInputAt === 0)`, so a document nobody has acted in yet still yields to first-render navigation while a reader who scrolled back to the top gets the same rAF and 150 ms restore as any other position; pinned by the controller.spec.ts case 'keeps a reader who scrolled back to the top at the top' (wheel to 800 then 0, write, foreign scroll to 600 at +100 ms with no input, scrollTop 0 after the late pass and on the next write)", "files": ["src/controller.ts", "src/__tests__/controller.spec.ts"]}]}
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