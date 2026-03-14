/**
 * Swarm Service
 *
 * Owns the bee-js Bee client instance and exposes it to other main-process
 * modules. The client is created lazily from the service registry's active
 * Bee API URL and recreated if the URL changes.
 */

const { Bee } = require('@ethersphere/bee-js');
const { getBeeApiUrl } = require('../service-registry');
const log = require('electron-log');

let beeClient = null;
let beeClientUrl = null;

/**
 * Get or create the Bee client. Recreates if the Bee API URL has changed.
 */
function getBee() {
  const url = getBeeApiUrl();
  if (!beeClient || beeClientUrl !== url) {
    beeClient = new Bee(url);
    beeClientUrl = url;
    log.info(`[SwarmService] Bee client created for ${url}`);
  }
  return beeClient;
}

/**
 * Reset the cached client (e.g. on Bee restart).
 */
function resetBeeClient() {
  beeClient = null;
  beeClientUrl = null;
}

module.exports = {
  getBee,
  resetBeeClient,
};
