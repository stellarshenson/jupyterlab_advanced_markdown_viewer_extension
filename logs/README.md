# Logs

| Log                                     | Tracks                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-install.log`                      | Output of `make install` - nodeenv creation, dependency install, TypeScript build, labextension build and pip install                                                            |
| `make-test.log`                         | Output of `make test` - jest unit suite with coverage, then pytest for the server extension                                                                                      |
| `build-cycle.log`                       | One test-then-install cycle: `make test`, and `make install` only when the tests passed                                                                                          |
| `galata.log`                            | Output of the Playwright / Galata integration run in `ui-tests/`, including the test server's own log lines                                                                      |
| `jest.log`, `pytest.log`, `lint.log`    | The proving executor's unit, server and lint runs on the build named in `make-install.log`                                                                                       |
| `galata-proving-*.log`, `proving-*.log` | Narrowed Galata runs and the mutation attacks on the installed bundle - each mutation named, the target tests that went red, the control that stayed green, and the restored md5 |

- `round8-chain.log` - ACC-NOTES-139 chain: Galata proof against 0.6.59, round-8 mutations, graph refresh, build 0.6.60, lint, both Galata suites; ends with CHAIN-DONE
- `round8b-chain.log` - strip order ruling: Galata proof against 0.6.60, graph refresh, build 1.0.2, lint, both Galata suites; ends with CHAIN-DONE
- `screenshots-chain.log` - README screenshots (ui-tests/tests/screenshots.spec.ts), rewritten by every run of the spec; the shipped files are from the last run; ends with SHOTS-DONE
- `round9-chain.log` - round-8 fixes: mutations, graph refresh, version reset to 1.0.1, build 1.0.2 (second build of that number, the first carried the round-8 findings), lint, full jest to `jest-102.log`, both Galata suites to `galata-102-second-*.log`, screenshots rerun; ends with CHAIN-DONE
- `galata-102-second-rerun-138.log` - ACC-NOTES-138 rerun three times on the second 1.0.2 build after its one timeout during the low-memory event
- `round9-mutations-rerun.log` - the round-9 mutation runner rerun with the corrected first mutation, 4 of 4 caught
- `lint-102-second.log` - lint on the second 1.0.2 build
- `round10-chain.log` - round-9 fixes: mutations to `mutation-*.log` (one log per mutation, the glob shared by every round's runner), graph refresh, version reset to 1.0.1, build 1.0.2 (third build of that number), lint to `lint-102-third.log`, full jest to `jest-102-third.log`, both Galata suites to `galata-102-third-*.log`, screenshots rerun; ends with CHAIN-DONE
- `round11-chain.log` - round-10 fixes: mutations, graph refresh, version reset to 1.0.3 so the build lands on the published 1.0.4, lint to `lint-104.log`, full jest to `jest-104.log`, both Galata suites to `galata-104-*.log`, screenshots rerun; ends with CHAIN-DONE
- `galata-104-rerun-3.log` - the three cases that failed in the round-11 chain while the sibling extensions were being rebuilt in their own trees (ACC-NOTES-138 and two alerts-sibling cases), rerun on the settled lab: 3 passed
