# Logs

| Log                                     | Tracks                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-install.log`                      | Output of `make install` - nodeenv creation, dependency install, TypeScript build, labextension build and pip install                                                            |
| `make-test.log`                         | Output of `make test` - jest unit suite with coverage, then pytest for the server extension                                                                                      |
| `build-cycle.log`                       | One test-then-install cycle: `make test`, and `make install` only when the tests passed                                                                                          |
| `galata.log`                            | Output of the Playwright / Galata integration run in `ui-tests/`, including the test server's own log lines                                                                      |
| `jest.log`, `pytest.log`, `lint.log`    | The proving executor's unit, server and lint runs on the build named in `make-install.log`                                                                                       |
| `galata-proving-*.log`, `proving-*.log` | Narrowed Galata runs and the mutation attacks on the installed bundle - each mutation named, the target tests that went red, the control that stayed green, and the restored md5 |
