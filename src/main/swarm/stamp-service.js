/**
 * Stamp Service
 *
 * Postage batch operations via bee-js: list, cost estimation, and purchase.
 * All bee-js types stay behind this boundary — the renderer receives
 * normalized Freedom batch model objects.
 */

const { ipcMain } = require('electron');
const { Size, Duration } = require('@ethersphere/bee-js');
const { getBee } = require('./swarm-service');
const log = require('electron-log');

/**
 * Normalize a bee-js batch object to the Freedom batch model.
 */
function normalizeBatch(batch) {
  const sizeBytes = typeof batch.size?.bytes === 'number'
    ? batch.size.bytes
    : Number(batch.size ?? 0);

  const remainingBytes = typeof batch.remainingSize?.bytes === 'number'
    ? batch.remainingSize.bytes
    : Number(batch.remainingSize ?? 0);

  const usageRaw = typeof batch.usage === 'number'
    ? batch.usage
    : parseFloat(batch.usage ?? 0);

  const usagePercent = Math.round(usageRaw * 100);

  const ttlSeconds = typeof batch.duration === 'number'
    ? batch.duration
    : Number(batch.duration ?? 0);

  return {
    batchId: batch.batchID || batch.batchId || '',
    usable: batch.usable === true,
    isMutable: batch.immutableFlag === false || batch.mutable === true || false,
    sizeBytes,
    remainingBytes,
    usagePercent,
    ttlSeconds,
  };
}

/**
 * List all postage batches, normalized to the Freedom batch model.
 */
async function getStamps() {
  const bee = getBee();
  const batches = await bee.getAllPostageBatch();
  return batches.map(normalizeBatch);
}

/**
 * Estimate cost for a new batch with the given size and duration.
 * Returns a formatted xBZZ string.
 */
async function getStorageCost(sizeGB, durationDays) {
  const bee = getBee();
  const cost = await bee.getStorageCost(
    Size.fromGigabytes(sizeGB),
    Duration.fromDays(durationDays)
  );

  return {
    bzz: cost.toSignificantDigits(4),
  };
}

/**
 * Purchase a new postage batch.
 * Returns { success, batchId } or { success: false, error }.
 */
async function buyStorage(sizeGB, durationDays) {
  const bee = getBee();
  const batchId = await bee.buyStorage(
    Size.fromGigabytes(sizeGB),
    Duration.fromDays(durationDays)
  );

  log.info(`[StampService] Purchased batch ${batchId} (${sizeGB} GB, ${durationDays} days)`);
  return batchId;
}

/**
 * Register IPC handlers for stamp operations.
 */
function registerSwarmIpc() {
  ipcMain.handle('swarm:get-stamps', async () => {
    try {
      const stamps = await getStamps();
      return { success: true, stamps };
    } catch (err) {
      log.error('[StampService] Failed to get stamps:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:get-storage-cost', async (_event, sizeGB, durationDays) => {
    try {
      if (!sizeGB || sizeGB <= 0 || !durationDays || durationDays <= 0) {
        return { success: false, error: 'Size and duration must be positive numbers' };
      }
      const cost = await getStorageCost(sizeGB, durationDays);
      return { success: true, ...cost };
    } catch (err) {
      log.error('[StampService] Failed to estimate storage cost:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:buy-storage', async (_event, sizeGB, durationDays) => {
    try {
      if (!sizeGB || sizeGB <= 0 || !durationDays || durationDays <= 0) {
        return { success: false, error: 'Size and duration must be positive numbers' };
      }
      const batchId = await buyStorage(sizeGB, durationDays);
      return { success: true, batchId };
    } catch (err) {
      log.error('[StampService] Failed to buy storage:', err.message);
      return { success: false, error: err.message };
    }
  });

  log.info('[StampService] IPC handlers registered');
}

module.exports = {
  normalizeBatch,
  getStamps,
  getStorageCost,
  buyStorage,
  registerSwarmIpc,
};
