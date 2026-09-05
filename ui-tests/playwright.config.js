/**
 * Configuration for Playwright using default from @jupyterlab/galata.
 *
 * The port is threaded through one variable so a developer with their own lab
 * on 8888 can run the suite. Galata pins the test server to a port and sets no
 * retries, so both ends must agree or the server dies rather than move.
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

const PORT = process.env.JUPYTER_TEST_PORT || '8888';
const BASE_URL = `http://localhost:${PORT}`;

module.exports = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: BASE_URL
  },
  // The specs drive one server and write the same fixture paths, so they run
  // one at a time rather than racing each other through the contents API.
  workers: 1,
  fullyParallel: false,
  webServer: {
    command: 'jlpm start',
    url: `${BASE_URL}/lab`,
    timeout: 120 * 1000,
    reuseExistingServer: false
  }
};
