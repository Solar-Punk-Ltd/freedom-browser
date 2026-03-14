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

const BUY_TIMEOUT_MS = 300000; // 5 minutes — chain tx can be slow

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Normalize a bee-js PostageBatch to the Freedom batch model.
 * Uses public bee-js class methods (toBytes, toSeconds) rather than
 * private properties.
 */
function normalizeBatch(batch) {
  let sizeBytes = 0;
  if (batch.size && typeof batch.size.toBytes === 'function') {
    sizeBytes = batch.size.toBytes();
  } else if (typeof batch.size === 'number') {
    sizeBytes = batch.size;
  }

  let remainingBytes = 0;
  if (batch.remainingSize && typeof batch.remainingSize.toBytes === 'function') {
    remainingBytes = batch.remainingSize.toBytes();
  } else if (typeof batch.remainingSize === 'number') {
    remainingBytes = batch.remainingSize;
  }

  let ttlSeconds = 0;
  if (batch.duration && typeof batch.duration.toSeconds === 'function') {
    ttlSeconds = batch.duration.toSeconds();
  } else if (typeof batch.duration === 'number') {
    ttlSeconds = batch.duration;
  }

  const usageRaw = typeof batch.usage === 'number' ? batch.usage : 0;

  return {
    batchId: batch.batchID || '',
    usable: batch.usable === true,
    isMutable: batch.immutableFlag === false,
    sizeBytes,
    remainingBytes,
    usagePercent: Math.round(usageRaw * 100),
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
 */
async function buyStorage(sizeGB, durationDays) {
  const bee = getBee();
  const batchId = await bee.buyStorage(
    Size.fromGigabytes(sizeGB),
    Duration.fromDays(durationDays),
    { timeout: BUY_TIMEOUT_MS }
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
      if (!isPositiveNumber(sizeGB) || !isPositiveNumber(durationDays)) {
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
      if (!isPositiveNumber(sizeGB) || !isPositiveNumber(durationDays)) {
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
  registerSwarmIpc,
};
