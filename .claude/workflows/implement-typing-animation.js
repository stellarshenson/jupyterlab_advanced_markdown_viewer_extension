export const meta = {
  name: 'implement-typing-animation',
  description: 'Understand the live preview code, design the typed-in change animation from three angles, implement the chosen design, verify each ANIM criterion adversarially and fix until every criterion holds',
  phases: [
    { title: 'Understand', detail: 'one reader maps the render, decorate, fade and settings paths' },
    { title: 'Design', detail: 'three independent designs, one judge, one plan' },
    { title: 'Implement', detail: 'one implementer applies the plan with unit tests and Galata specs' },
    { title: 'Verify', detail: 'one verifier per criterion tries to refute it; a fixer answers real defects' },
  ],
}

const P = args.project
const COMMON = `Project: ${P}. Work only inside it. Locked facts and rules (authoritative, do not dispute): ${args.locked}\n\nRequirement intent: ${args.intent}\n\nCriteria: ${args.criteria}. Read them from the file; each carries a test line and a mechanism line - the mechanism line is a proposal, the intent and the test line are the spec.`

const MAP_SCHEMA = { type: 'object', required: ['summary', 'sites', 'risks'], properties: {
  summary: { type: 'string' },
  sites: { type: 'array', items: { type: 'object', required: ['file', 'symbol', 'role'], properties: { file: { type: 'string' }, symbol: { type: 'string' }, role: { type: 'string' }, lines: { type: 'string' } } } },
  affected: { type: 'array', items: { type: 'string' } },
  risks: { type: 'array', items: { type: 'string' } } } }

const PROPOSAL_SCHEMA = { type: 'object', required: ['name', 'approach', 'tradeoffs', 'steps', 'risks'], properties: {
  name: { type: 'string' }, approach: { type: 'string' }, tradeoffs: { type: 'string' },
  steps: { type: 'array', items: { type: 'object', required: ['file', 'change'], properties: { file: { type: 'string' }, change: { type: 'string' } } } },
  unitTests: { type: 'array', items: { type: 'string' } }, galataTests: { type: 'array', items: { type: 'string' } },
  risks: { type: 'array', items: { type: 'string' } } } }

const PLAN_SCHEMA = { type: 'object', required: ['chosen', 'rationale', 'steps', 'unitTests', 'galataTests'], properties: {
  chosen: { type: 'string' }, rationale: { type: 'string' },
  steps: { type: 'array', items: { type: 'object', required: ['file', 'change', 'check'], properties: { file: { type: 'string' }, change: { type: 'string' }, check: { type: 'string' } } } },
  unitTests: { type: 'array', items: { type: 'string' } }, galataTests: { type: 'array', items: { type: 'string' } },
  grafted: { type: 'array', items: { type: 'string' } }, rejected: { type: 'array', items: { type: 'string' } } } }

const IMPL_SCHEMA = { type: 'object', required: ['changedFiles', 'jest', 'tsc', 'lint', 'notes'], properties: {
  changedFiles: { type: 'array', items: { type: 'string' } },
  jest: { type: 'object', required: ['passed', 'failed'], properties: { passed: { type: 'integer' }, failed: { type: 'integer' } } },
  tsc: { type: 'string', enum: ['ok', 'fail'] }, lint: { type: 'string', enum: ['ok', 'fail'] },
  notes: { type: 'string' }, openIssues: { type: 'array', items: { type: 'string' } } } }

const VERDICT_SCHEMA = { type: 'object', required: ['criterion', 'met', 'evidence'], properties: {
  criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' },
  defect: { type: 'string' }, remedy: { type: 'string' } } }

phase('Understand')
const map = await agent(`${COMMON}\n\nYou are the reader. Read src/controller.ts, src/highlight.ts, src/diff.ts, src/index.ts, schema/plugin.json, style/base.css, src/__tests__/controller.spec.ts, src/__tests__/highlight.spec.ts and ui-tests/tests/live-view.spec.ts, and the Galata section of /home/lab/.claude/skills/jupyterlab-extension/SKILL.md. Run graphify affected for src_highlight_decorate, src_highlight_makedecoration, src_controller_liveviewcontroller_onrendered, src_controller_liveviewcontroller_schedulefade, src_controller_liveviewcontroller_endfade, src_index_readsettings (and the semantic ids src_controller__onrendered, src_controller__schedulefade if the AST ids return nothing). Return a map of the exact sites a typing animation must touch: where added spans and ghosts are created and given their fade-in, where the fade timer and baseline hold live, how fresh ranges are computed and passed, how a setting travels from schema to controller, how the tests build a widget and drive timers, and how a Galata test reads decorations. List the risks you see (reflow during typing, interaction with the held baseline, a render arriving mid-animation, headings, reduced motion, jsdom limits).`, { label: 'read:code-map', phase: 'Understand', schema: MAP_SCHEMA })

if (!map) throw new Error('reader returned nothing')
log(`map: ${map.sites.length} sites, ${map.risks.length} risks`)

phase('Design')
const ANGLES = [
  { key: 'fidelity', brief: 'Design for maximum fidelity to the intent: the text visibly grows letter by letter and shrinks from the end, exactly like typing and backspacing, even at the cost of layout reflow. Say how reflow is kept tolerable at 200 characters per second across several spans at once.' },
  { key: 'stability', brief: 'Design for layout stability and performance: the full text occupies its final space from the first frame and letters become visible one by one (per-character wrapping with staggered CSS delays, or an equivalent), deletion reverses it. Say how this still reads as typing and how it honours the no-box-model rule on decoration spans.' },
  { key: 'continuity', brief: 'Design around the hardest criterion, ACC-ANIM-78 (a write during an animation continues it) together with the held-baseline fade: state exactly what state survives a wholesale re-render, how fresh ranges decide what still types, and how a ghost that was already warned about is not warned about twice. Choose whichever rendering technique makes that simplest.' },
]
const proposals = await parallel(ANGLES.map(a => () => agent(`${COMMON}\n\nCode map from the reader: ${JSON.stringify(map)}\n\nYou are one of three designers. Your angle: ${a.brief}\n\nProduce one concrete design: the rendering technique, the timer or animation model, the data kept between renders, how animationSpeed (integer characters per second, default ${args.defaultSpeed}, 0 = off) reaches it, how reduced motion is honoured (guard window.matchMedia for jsdom), how headings are excluded, how the green fade-out is sequenced after typing completes and the ghost removal after its deletion completes, and the exact unit tests (jest, fake timers) and Galata tests that prove each criterion ACC-ANIM-73 to 79. Read the code before proposing; cite file and function names. Do not edit any file.`, { label: `design:${a.key}`, phase: 'Design', schema: PROPOSAL_SCHEMA })))
const live = proposals.filter(Boolean)
log(`designs: ${live.length}/3`)

const plan = await agent(`${COMMON}\n\nCode map: ${JSON.stringify(map)}\n\nThree designs:\n${live.map((p, i) => `--- design ${i + 1}: ${p.name}\n${JSON.stringify(p)}`).join('\n')}\n\nYou are the judge. Score each design against: fidelity to the intent and the seven criteria; robustness to a wholesale re-render mid-animation and to the held baseline; respect for the locked rules (no direct children of the render root, heading text and ids untouched, no box-model property on decoration spans, CSS namespace); performance for a burst that adds a few thousand characters in several places; simplicity (the minimum that meets the criteria, nothing speculative). Pick one, graft anything better from the others, and write the implementation plan: ordered steps with file, change and the check that proves the step (a named unit test or a command), the list of unit tests and Galata tests to add, the schema entry for ${args.settingKey}, and what you rejected and why. Read the code where the designs disagree about it. Do not edit any file.`, { label: 'judge:plan', phase: 'Design', schema: PLAN_SCHEMA })
if (!plan) throw new Error('judge returned nothing')
log(`plan: ${plan.chosen} - ${plan.steps.length} steps, ${plan.unitTests.length} unit tests, ${plan.galataTests.length} galata tests`)

phase('Implement')
const impl = await agent(`${COMMON}\n\nCode map: ${JSON.stringify(map)}\n\nImplementation plan (follow it; deviate only where the code proves a step wrong, and say so in notes): ${JSON.stringify(plan)}\n\nYou are the implementer. Before editing each existing symbol run graphify affected for it and keep the edit inside the affected set. Implement every step: source, schema/plugin.json (${args.settingKey}, integer, minimum 0, default ${args.defaultSpeed}, with title and description), style/base.css if the design needs CSS, unit tests in src/__tests__ (existing 62 tests must keep passing), and Galata tests appended to ui-tests/tests/live-view.spec.ts following the existing helpers and the skill's conventions (you cannot run Galata; write them so the main session can). Match the surrounding code style and comment voice. Then run in the project root: jlpm prettier; npx tsc --noEmit -p tsconfig.json; npx jest; jlpm run lint:check. Fix until tsc, jest and lint:check all pass with zero errors and zero warnings. Refresh the graph afterwards with: mkdir -p tmp && (cd tmp && GRAPHIFY_OUT=tmp/graphify-out graphify update ..). Report the changed files, the jest counts, tsc and lint results, notes on deviations, and any open issue you could not settle.`, { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA })
if (!impl) throw new Error('implementer returned nothing')
log(`implemented: ${impl.changedFiles.length} files, jest ${impl.jest.passed}/${impl.jest.passed + impl.jest.failed}, tsc ${impl.tsc}, lint ${impl.lint}`)

phase('Verify')
const CRITERIA = ['ACC-ANIM-73', 'ACC-ANIM-74', 'ACC-ANIM-75', 'ACC-ANIM-76', 'ACC-ANIM-77', 'ACC-ANIM-78', 'ACC-ANIM-79']
let history = []
let round = 0
let unmet = []
while (round < 3) {
  round++
  const verdicts = (await parallel(CRITERIA.map(c => () => agent(`${COMMON}\n\nThe implementation is in the working tree (changed files: ${impl.changedFiles.join(', ')}). Previous verification rounds: ${JSON.stringify(history)}\n\nYou are a hostile verifier for one criterion: ${c}. Read it from the criteria file, then read the code and the tests and try to REFUTE that it is met: find an input, a timing, or a state (a re-render mid-animation, a heading, reduced motion, speed 0, a burst in two paragraphs, a ghost past the token bound) where the behaviour departs from the criterion's text or from the locked rules. Run npx jest and, where a claim needs it, write a throwaway jest test under src/__tests__ (name it verify-*.spec.ts) that demonstrates the departure, run it, and DELETE it afterwards whatever the outcome. met=false only for a departure you demonstrated or traced in code with file and line; a taste preference is not a defect. Give the evidence, and for a defect the smallest remedy.`, { label: `verify:${c}:r${round}`, phase: 'Verify', schema: VERDICT_SCHEMA })))).filter(Boolean)
  unmet = verdicts.filter(v => !v.met)
  history.push({ round, unmet: unmet.map(v => ({ criterion: v.criterion, defect: v.defect })) })
  log(`verify round ${round}: ${verdicts.length - unmet.length}/${verdicts.length} met`)
  if (!unmet.length) break
  const fix = await agent(`${COMMON}\n\nPlan: ${JSON.stringify(plan)}\nImplementer notes: ${impl.notes}\n\nVerified defects to fix (each with evidence and a proposed remedy): ${JSON.stringify(unmet)}\n\nYou are the fixer. Confirm each defect reproduces before changing anything; a defect that does not reproduce is reported in notes and left alone. Fix the real ones at root cause with the smallest change, add or adjust a unit test per fix, keep every existing test passing, and run: jlpm prettier; npx tsc --noEmit -p tsconfig.json; npx jest; jlpm run lint:check. Refresh the graph afterwards: mkdir -p tmp && (cd tmp && GRAPHIFY_OUT=tmp/graphify-out graphify update ..). Report changed files, jest counts, tsc and lint results, and notes.`, { label: `fix:r${round}`, phase: 'Verify', schema: IMPL_SCHEMA })
  if (fix) { impl.changedFiles = Array.from(new Set(impl.changedFiles.concat(fix.changedFiles))); impl.jest = fix.jest; impl.tsc = fix.tsc; impl.lint = fix.lint; impl.notes += `\nfix round ${round}: ${fix.notes}` }
}

return { status: unmet.length ? 'UNMET' : 'MET', plan: { chosen: plan.chosen, rationale: plan.rationale, rejected: plan.rejected, galataTests: plan.galataTests }, changedFiles: impl.changedFiles, jest: impl.jest, tsc: impl.tsc, lint: impl.lint, notes: impl.notes, openIssues: impl.openIssues || [], verification: history }