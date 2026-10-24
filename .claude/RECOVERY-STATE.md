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

## BRACE 2026-10-24 22:55 CEST - usage limit

**HORIZON: LIMIT.** Probe output: `LIMIT 96% seven_day resets 2:00am (7444m)`. The host stays up. The same session returns after the reset (7444 minutes from 22:55 on 2026-10-24, so 2:00 am on 2026-10-30) with `claude --continue` in this project. Detached compute survives. One workflow was paused.

### Campaign

- Active `/goal` (do not tell the user to run `/goal clear`): "EXTENSION_COMPLETE: All functionality done per acceptance criteria. Acceptance criteria updated via /project-management:project-management. Unit and functional tests updated and green. No defects open. Root causes found and fixed or rejected by user. Survived /devils-advocate:adversarial-review with the /graphify graph with AST only and a panel of architect, bug-hunter and ux-designer, /ponytail-review fed to adversarial review, last round SHIP"
- Work: settings reduced to four, seven tuning values in the server config (traitlets `AdvancedMarkdownViewer`), notes on images (DEF-NOTES-137). Run record of the whole campaign: `tmp/workflows/review-settings-image/RUN.md`; journal entries 77-91
- Owner rulings of 2026-10-24: stop the edge-case chase after fix run 6; delete the image-scan code for constructs outside the bar (HTML types 1, 3, 4, 5, raw-text and raw inline tags, lazy and nested quote rules); differences from marked outside the bar are rejected (image notes turn off for such a document, nothing is written)
- Model for executors: Opus 5.5. Review loop: installed devils-advocate 1.8.26 (`/home/lab/.claude/plugins/cache/stellarshenson-marketplace/devils-advocate/1.8.26/skills/adversarial-review/workflows/adversarial-loop.js`), which has the `findings` input

### Paused workflow

- Fix run 7: run id `wf_107bf09f-baa`, script `/home/lab/workspace/private/jupyterlab/jupyterlab_advanced_markdown_viewer_extension/tmp/workflows/review-settings-image/fix-round.js`, args verbatim in `tmp/workflows/review-settings-image/args-fix7.json`, transcript dir `/home/lab/.claude/projects/-home-lab-workspace-private-jupyterlab-jupyterlab-advanced-markdown-viewer-extension/f5dec114-319e-490e-b968-fcf29f4a5f6e/subagents/workflows/wf_107bf09f-baa`
- Phase reached: Apply DONE (`r7/apply.json` status done, journal.jsonl holds its one result line; patches `r7/fix-1.patch` scan restored to the fix-run-4 base plus the in-bar fixes, `fix-2.patch` deleted test pins, `fix-5.patch` trackers). Verify had started: gates:0 was in `make test` at the stop; no `r7/gates-0.json` exists
- Resume, same session: `Workflow({scriptPath: "<script above>", resumeFromRunId: "wf_107bf09f-baa", args: <contents of args-fix7.json>})` - the apply agent replays from cache, gates:0 runs again. If nothing is cached: `Workflow({scriptPath, args})` from the same file; the apply agent finds `r7/apply.json` done and returns it
- Tree difference made by the stop: none (`git status --porcelain` 33 entries before and after)

### Running (not this project, leave alone)

- PID 3678764 Galata in `jupyterlab_advanced_html_viewer_extension/ui-tests`, PID 3746687 Galata in `jupyterlab_ai_code_assistants_extension/ui-tests`: other sessions' runs

### Valid on disk

- Fix run 7 apply: `src/anchor.ts` 1969 lines (HEAD 1601, before fix run 4 1914, before fix run 7 2414). `make test` green: jest 1124 of 1124, pytest 73 (`logs/test-review-r7a.log`). Real-document gate: sample-100 sameImages 100 → 100, sample-img-100 98 → 98. `tokeniseSource` median of 20 runs on sample-img-100: HEAD 188.4 ms, before fix run 4 207.0 ms, before fix run 7 639.0 ms, after 205.4 ms (`r7/time.out`)
- Trackers: DEF-NOTES-147-LAZY-MARKER rejected, DEF-NOTES-148-SCAN-GAPS filed and rejected (outside the bar, owner ruling); `pm-tools check docs/ --strict` 0 errors, 350 warnings (348 baseline plus 2)
- Fix run 6 (wf_bb288f03-f7a): gates green, Galata 229 passed 2 skipped; its last check's 9 findings are outside the bar
- Slop review `tmp/workflows/slop-review/`: SHIP, 5 of 6 MINOR hold, rows in `rows.json` (source "slop-hunter"); finding 1 (out-of-bar arms) is answered by fix run 7
- propose-goals skill edits: done and verified by this session and by the claude-code-plugins session (journal `~/.claude/JOURNAL.md` entries 46-47)

### Pending

1. Finish fix run 7 (resume above): gates (make test, lint, make install, full Galata suite), check, one fix round if needed
2. Check the slop rows against the new tree: drop finding 1 (answered), confirm 2, 3, 5, 6 still apply
3. Ponytail review: `tmp/workflows/ponytail-whole/workflow.js` (no args), rows to `tmp/workflows/ponytail-whole/findings.json`
4. Refresh the graph: `GRAPHIFY_OUT=tmp/graphify-out graphify update .`
5. Review round 6 with the installed 1.8.26 loop: the round 1 args (`tmp/workflows/review-settings-image/args-round1.json`), `state` from `round5-result.json` verbatim, `appliedFixes` from r4, r5, r6, r7 `apply.json` and `fix.json`, `findings` = ponytail rows plus the slop rows that still hold. Round 6 is the last under maxRounds 6
6. On SHIP: close-out workflow `tmp/workflows/close-out/workflow.js` for ACC-CONFIG-211 to 214, ACC-NOTES-215, DEF-NOTES-137; journal entries; ask for commit approval (no attribution trailer)

### FIRST ACTION

Resume fix run 7 in this session: `Workflow({scriptPath: "/home/lab/workspace/private/jupyterlab/jupyterlab_advanced_markdown_viewer_extension/tmp/workflows/review-settings-image/fix-round.js", resumeFromRunId: "wf_107bf09f-baa", args: <args-fix7.json>})`. Then pending item 2.
