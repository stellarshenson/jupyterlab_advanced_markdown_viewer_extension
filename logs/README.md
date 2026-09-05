# Logs

| Log                | Tracks                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `make-install.log` | Output of `make install` - nodeenv creation, dependency install, TypeScript build, labextension build and pip install |
| `make-test.log`    | Output of `make test` - jest unit suite with coverage, then pytest for the server extension                           |
| `build-cycle.log`  | One test-then-install cycle: `make test`, and `make install` only when the tests passed                               |
| `galata.log`       | Output of the Playwright / Galata integration run in `ui-tests/`, including the test server's own log lines           |
