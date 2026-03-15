/**
 * Publish Service
 *
 * Upload operations via bee-js: data, files, and directories.
 * All uploads use auto batch selection and return normalized results.
 * Runs in the main process only — renderer interacts via IPC.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const { getBee, selectBestBatch, toHex } = require('./swarm-service');
const log = require('electron-log');

/**
 * Normalize an UploadResult to a Freedom publish result.
 */
function normalizeUploadResult(result, batchIdUsed) {
  const reference = toHex(result.reference);
  return {
    reference,
    bzzUrl: reference ? `bzz://${reference}` : null,
    tagUid: result.tagUid || null,
    batchIdUsed: batchIdUsed || null,
  };
}

/**
 * Normalize a Bee Tag to a Freedom upload status.
 */
function normalizeTag(tag) {
  const split = tag.split || 0;
  const synced = tag.synced || 0;
  const progress = split > 0 ? Math.min(1, synced / split) : 0;

  return {
    tagUid: tag.uid,
    split,
    seen: tag.seen || 0,
    stored: tag.stored || 0,
    sent: tag.sent || 0,
    synced,
    progress: Math.round(progress * 100),
    done: split > 0 && synced >= split,
  };
}

/**
 * Publish raw data (string or Buffer).
 */
async function publishData(data, options = {}) {
  const bee = getBee();
  const sizeEstimate = Buffer.byteLength(data);
  const batchId = options.batchId || await selectBestBatch(sizeEstimate);

  if (!batchId) {
    throw new Error('No usable postage batch available. Purchase stamps first.');
  }

  const result = await bee.uploadData(batchId, data, {
    pin: true,
    deferred: false,
    ...options.uploadOptions,
  });

  return normalizeUploadResult(result, batchId);
}

/**
 * Publish a file from a filesystem path.
 */
async function publishFile(filePath, options = {}) {
  const bee = getBee();
  const stat = fs.statSync(filePath);
  const batchId = options.batchId || await selectBestBatch(stat.size);

  if (!batchId) {
    throw new Error('No usable postage batch available. Purchase stamps first.');
  }

  const stream = fs.createReadStream(filePath);
  const name = path.basename(filePath);
  const contentType = options.contentType || undefined;

  const result = await bee.uploadFile(batchId, stream, name, {
    pin: true,
    deferred: true,
    contentType,
    size: stat.size,
    ...options.uploadOptions,
  });

  return normalizeUploadResult(result, batchId);
}

/**
 * Publish a directory as a Swarm collection.
 * Auto-detects index.html as the default document.
 */
async function publishDirectory(dirPath, options = {}) {
  const bee = getBee();

  // Estimate total size (async to avoid blocking the event loop)
  const totalSize = await estimateDirSize(dirPath);

  const batchId = options.batchId || await selectBestBatch(totalSize);

  if (!batchId) {
    throw new Error('No usable postage batch available. Purchase stamps first.');
  }

  // Auto-detect index.html
  const indexPath = path.join(dirPath, 'index.html');
  const hasIndex = fs.existsSync(indexPath);

  const result = await bee.uploadFilesFromDirectory(batchId, dirPath, {
    pin: true,
    deferred: true,
    indexDocument: hasIndex ? 'index.html' : undefined,
    ...options.uploadOptions,
  });

  return normalizeUploadResult(result, batchId);
}

/**
 * Estimate total size of a directory tree without blocking the event loop.
 */
async function estimateDirSize(dirPath) {
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await estimateDirSize(full);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(full);
      total += stat.size;
    }
  }
  return total;
}

/**
 * Get upload progress for a tag.
 */
async function getUploadStatus(tagUid) {
  const bee = getBee();
  const tag = await bee.retrieveTag(tagUid);
  return normalizeTag(tag);
}

/**
 * Register IPC handlers for publish operations.
 */
function registerPublishIpc() {
  ipcMain.handle('swarm:publish-data', async (_event, data) => {
    try {
      if (!data && data !== '') {
        return { success: false, error: 'Data is required' };
      }
      const result = await publishData(data);
      return { success: true, ...result };
    } catch (err) {
      log.error('[PublishService] Failed to publish data:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:publish-file', async (_event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'File path is required' };
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const result = await publishFile(filePath);
      return { success: true, ...result };
    } catch (err) {
      log.error('[PublishService] Failed to publish file:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:publish-directory', async (_event, dirPath) => {
    try {
      if (!dirPath || typeof dirPath !== 'string') {
        return { success: false, error: 'Directory path is required' };
      }
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      const result = await publishDirectory(dirPath);
      return { success: true, ...result };
    } catch (err) {
      log.error('[PublishService] Failed to publish directory:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:get-upload-status', async (_event, tagUid) => {
    try {
      if (!tagUid || typeof tagUid !== 'number') {
        return { success: false, error: 'Tag UID is required' };
      }
      const status = await getUploadStatus(tagUid);
      return { success: true, ...status };
    } catch (err) {
      log.error('[PublishService] Failed to get upload status:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:pick-file', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: 'Select a file to publish',
      });
      if (result.canceled || !result.filePaths?.length) {
        return { success: true, path: null };
      }
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      log.error('[PublishService] File picker failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('swarm:pick-directory', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select a folder to publish',
      });
      if (result.canceled || !result.filePaths?.length) {
        return { success: true, path: null };
      }
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      log.error('[PublishService] Directory picker failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  log.info('[PublishService] IPC handlers registered');
}

module.exports = {
  normalizeUploadResult,
  normalizeTag,
  publishData,
  publishFile,
  publishDirectory,
  getUploadStatus,
  registerPublishIpc,
};
