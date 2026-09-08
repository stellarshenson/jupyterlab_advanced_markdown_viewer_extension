# Recovery State

## BRACE 2026-09-08 13:53 CEST - usage limit

**HORIZON: LIMIT.** Probe output: `LIMIT 97% five_hour resets 4:10pm (135m)`. The host stays up; the same session returns after 16:10 with `claude --continue` in this project. Detached compute survives; no Workflow runs were in flight.

### Campaign

Standing directive: improve the extension, `/graphify` to control changes, `/devils-advocate:adversarial-review` to review, fix all defects, address all acceptance criteria. Active `/goal`: all tests clear, all functionality implemented, Galata updated and green, four lenses (architect, ux-designer, bug-hunter, slop-hunter) survived, no defects left. Do not tell the user to run `/goal clear`.

### Running (detached, survives the brace)

- Build 0.6.48 plus the full Galata suite, one `setsid nohup bash -c` chain launched 13:52: `make install > logs/build-0648.log` then `ui-tests`: `JUPYTER_TEST_PORT=8911 jlpm playwright test tests/notes.spec.ts tests/siblings.spec.ts tests/settings.spec.ts --reporter=line > ../logs/galata-0648-notes-siblings-settings.log`, then the same for `tests/live-view.spec.ts tests/events.spec.ts tests/stream.spec.ts tests/tab-cue.spec.ts > ../logs/galata-0648-live-events-stream-cue.log`, then `echo CHAIN-DONE >> ../logs/galata-0648-live-events-stream-cue.log`. Expected: 82 passed then 41 passed, about 10 min in total
- Read a log with `sed 's/\x1b\[[0-9;]*[A-Za-z]//g' <log> | grep -E '^\s*[0-9]+ (passed|failed)|^\s+[0-9]+\) '`
- Cold restart if the chain is missing: the same chain from the project root

### Stopped

- Four `devils-advocate:adversarial-reviewer` subagents (round 3, lenses architect, ux-designer, bug-hunter, slop-hunter) were told to write partial reports to `tmp/campaign/siblings/round3/<lens>.md` with first line `VERDICT: PARTIAL` and stop. A report absent or PARTIAL means that lens must be re-spawned on the brief `tmp/campaign/siblings/round3/prompt.md` (items 1-11, diffs regenerated 13:51 including `src/icons.ts` against /dev/null)
- Background wait `brlmp6t83` on the Galata chain stopped; re-arm on resume

### Valid on disk

- Build 0.6.47: Galata 81 passed (`logs/galata-0647-notes-siblings-settings.log`) and 41 passed (`logs/galata-0647-live-events-stream-cue.log`); jest 464/464
- DEF-NOTES-50 (bright unthemed focus ring around the rendered Markdown after a tab switch): filed, root cause recorded, fixed in `style/base.css` (`.jp-MarkdownViewer:focus { outline: none; }`), Galata test added to `ui-tests/tests/notes.spec.ts` ('DEF-NOTES-50 draws no focus ring ...'). OPEN until the 0.6.48 run passes; probe evidence on 0.6.47 without the rule: outline `auto 1px` on the focused viewer in mouse, keyboard and shortcut switches, screenshots `tmp/campaign/def50/`
- ACC-NOTES-124 closed 13:51; criteria open: 0; defects open: 1 (DEF-NOTES-50); `pm-tools check docs --strict` 0 errors
- Uncommitted working tree (all intended): src, style, tests, docs, jest.config.js, package.json/lock/yarn.lock (version 0.6.48 from make install), new `src/icons.ts`. The user's screenshot `2026-09-08 13_47_32-Danæg Pilot Proposal - Foxit PDF Reader.png` in the project root is theirs, untracked, leave it

### Pending

1. Read the 0.6.48 logs; if both halves pass, close DEF-NOTES-50 via `pm-tools close docs/defects.md --id DEF-NOTES-50 --author @kj --evidence "..."` naming the test and the log, then `pm-tools check docs --strict`
2. Round 3: read `tmp/campaign/siblings/round3/*.md`; re-spawn any lens absent or PARTIAL; merge with `review-tools findings`; adjudicate with `devils-advocate:adjudicator` if findings; two consecutive clean rounds end the loop
3. Journal entry via `/journal:update` (never edit JOURNAL.md directly): builds 0.6.44 to 0.6.48, round 2 fixes, submenu, muted swatches, DEF-NOTES-50
4. Then say the work is done and ask for commit approval; no attribution trailer; release only on explicit approval. Siblings (refresh-view 1.2.31, export 1.6.29, switch-tab 1.0.8) must publish with the attribute before or with the viewer; `tmp/` not gitignored in the refresh-view and switch-tab siblings

### FIRST ACTION

Check the chain: `grep -c CHAIN-DONE logs/galata-0648-live-events-stream-cue.log` and `pgrep -fa 'playwright test'`. Then pending item 1.
