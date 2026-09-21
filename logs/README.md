# Logs

Index only. What a run found belongs in `.claude/JOURNAL.md`,
`docs/acc-crit-advanced-markdown-viewer.md` and `docs/defects.md`.

Names are `<kind>-<id>[<letter>][-<scope>].log`: `<id>` is the criterion or defect,
`<letter>` counts attempts on it.

| Family                    | Holds                                   |
| ------------------------- | --------------------------------------- |
| `build-*.log`             | `make install`                          |
| `publish-<version>.log`   | `make publish`                          |
| `jest-*.log`              | `jlpm jest`                             |
| `lint-*.log`              | `jlpm run lint:check`                   |
| `prettier-*.log`          | `jlpm prettier`                         |
| `galata-*-full.log`       | the whole Playwright suite              |
| `galata-*-notes.log`      | `ui-tests/tests/notes.spec.ts`          |
| `galata-*-probe.log`      | a few browser cases, named by `-g`      |
| `galata-*-proof-*.log`    | browser cases against an older bundle   |
| `galata-*-siblings*.log`  | the sibling-extension browser cases     |
| `galata-*-repeat-<n>.log` | one browser case repeated, for a flake  |
| `e2e-*.log`               | the Playwright Python driver            |
| `mutation-*.log`          | mutation attacks, then the suite totals |
| `review-*-round<N>.log`   | one adversarial review round            |
| `*chain*.log`             | a scripted sequence of the above        |
