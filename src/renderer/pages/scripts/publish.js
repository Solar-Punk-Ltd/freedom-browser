// Publish on Swarm — freedom://publish
//
// Uses freedomAPI.swarm.* (internal-only, guarded by webview preload)

const swarm = window.freedomAPI?.swarm;

const PROGRESS_POLL_MS = 2000;

// DOM refs
const statusBanner = document.getElementById('publish-status-banner');
const actionsSection = document.getElementById('publish-actions');
const publishFileBtn = document.getElementById('publish-file-btn');
const publishFolderBtn = document.getElementById('publish-folder-btn');
const publishTextBtn = document.getElementById('publish-text-btn');
const textInputSection = document.getElementById('publish-text-input');
const textArea = document.getElementById('publish-text-area');
const textSubmitBtn = document.getElementById('publish-text-submit');
const textCancelBtn = document.getElementById('publish-text-cancel');
const progressSection = document.getElementById('publish-progress');
const progressText = document.getElementById('publish-progress-text');
const progressFill = document.getElementById('publish-progress-fill');
const resultSection = document.getElementById('publish-result');
const resultUrl = document.getElementById('publish-result-url');
const resultRef = document.getElementById('publish-result-ref');
const copyUrlBtn = document.getElementById('publish-copy-url');
const copyRefBtn = document.getElementById('publish-copy-ref');
const openUrlBtn = document.getElementById('publish-open-url');
const publishAnotherBtn = document.getElementById('publish-another');
const errorSection = document.getElementById('publish-error');
const errorText = document.getElementById('publish-error-text');
const errorRetryBtn = document.getElementById('publish-error-retry');

let progressPollTimeout = null;
let lastResult = null;

// ============================================
// Init
// ============================================

async function init() {
  if (!swarm) {
    showBanner('Swarm publishing API is not available.', 'error');
    disableActions();
    return;
  }

  // Check if stamps are available
  try {
    const stampsResult = await swarm.getStamps();
    if (!stampsResult?.success || !stampsResult.stamps?.some((s) => s.usable)) {
      showBanner('No usable postage stamps. Purchase stamps before publishing.', 'warn');
      disableActions();
      return;
    }
  } catch {
    showBanner('Could not check stamp availability.', 'warn');
  }

  // Wire up actions
  publishFileBtn?.addEventListener('click', handlePublishFile);
  publishFolderBtn?.addEventListener('click', handlePublishFolder);
  publishTextBtn?.addEventListener('click', showTextInput);
  textSubmitBtn?.addEventListener('click', handlePublishText);
  textCancelBtn?.addEventListener('click', resetToActions);
  publishAnotherBtn?.addEventListener('click', resetToActions);
  errorRetryBtn?.addEventListener('click', resetToActions);
  copyUrlBtn?.addEventListener('click', () => copyToClipboard(lastResult?.bzzUrl));
  copyRefBtn?.addEventListener('click', () => copyToClipboard(lastResult?.reference));
  openUrlBtn?.addEventListener('click', () => {
    if (lastResult?.bzzUrl) {
      window.freedomAPI?.openInNewTab?.(lastResult.bzzUrl);
    }
  });

  resultUrl?.addEventListener('click', (e) => {
    e.preventDefault();
    if (lastResult?.bzzUrl) {
      window.freedomAPI?.openInNewTab?.(lastResult.bzzUrl);
    }
  });
}

// ============================================
// View management
// ============================================

function showView(view) {
  actionsSection?.classList.toggle('hidden', view !== 'actions');
  textInputSection?.classList.toggle('hidden', view !== 'text');
  progressSection?.classList.toggle('hidden', view !== 'progress');
  resultSection?.classList.toggle('hidden', view !== 'result');
  errorSection?.classList.toggle('hidden', view !== 'error');
}

function resetToActions() {
  stopProgressPoll();
  lastResult = null;
  if (textArea) textArea.value = '';
  showView('actions');
}

function showTextInput() {
  showView('text');
  textArea?.focus();
}

function showBanner(message, type) {
  if (statusBanner) {
    statusBanner.textContent = message;
    statusBanner.className = `publish-banner ${type}`;
    statusBanner.classList.remove('hidden');
  }
}

function disableActions() {
  [publishFileBtn, publishFolderBtn, publishTextBtn].forEach((btn) => {
    if (btn) btn.disabled = true;
  });
}

// ============================================
// Publish handlers
// ============================================

async function handlePublishFile() {
  try {
    const picked = await swarm.pickFileForPublish();
    if (!picked?.success || !picked.path) return;

    showView('progress');
    setProgress('Uploading file\u2026', 0);

    const result = await swarm.publishFilePath(picked.path);

    if (!result?.success) {
      showError(result?.error || 'Upload failed.');
      return;
    }

    // Poll for sync progress if we have a tag
    if (result.tagUid) {
      await pollProgress(result.tagUid, 'Syncing file\u2026');
    }

    showResult(result);
  } catch (err) {
    showError(err.message || 'Upload failed.');
  }
}

async function handlePublishFolder() {
  try {
    const picked = await swarm.pickDirectoryForPublish();
    if (!picked?.success || !picked.path) return;

    showView('progress');
    setProgress('Uploading folder\u2026', 0);

    const result = await swarm.publishDirectoryPath(picked.path);

    if (!result?.success) {
      showError(result?.error || 'Upload failed.');
      return;
    }

    if (result.tagUid) {
      await pollProgress(result.tagUid, 'Syncing folder\u2026');
    }

    showResult(result);
  } catch (err) {
    showError(err.message || 'Upload failed.');
  }
}

async function handlePublishText() {
  const text = textArea?.value;
  if (!text) return;

  try {
    showView('progress');
    setProgress('Publishing text\u2026', 0);

    const result = await swarm.publishData(text);

    if (!result?.success) {
      showError(result?.error || 'Publish failed.');
      return;
    }

    showResult(result);
  } catch (err) {
    showError(err.message || 'Publish failed.');
  }
}

// ============================================
// Progress polling
// ============================================

function setProgress(text, percent) {
  if (progressText) progressText.textContent = text;
  if (progressFill) progressFill.style.width = `${percent}%`;
}

async function pollProgress(tagUid, label) {
  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const status = await swarm.getUploadStatus(tagUid);
        if (status?.success) {
          setProgress(`${label} ${status.progress}%`, status.progress);
          if (status.done) {
            resolve();
            return;
          }
        }
      } catch {
        // Keep polling
      }
      progressPollTimeout = setTimeout(poll, PROGRESS_POLL_MS);
    };
    poll();
  });
}

function stopProgressPoll() {
  if (progressPollTimeout) {
    clearTimeout(progressPollTimeout);
    progressPollTimeout = null;
  }
}

// ============================================
// Result display
// ============================================

function showResult(result) {
  lastResult = result;
  showView('result');

  if (resultUrl) {
    resultUrl.textContent = result.bzzUrl || '--';
    resultUrl.href = '#';
  }

  if (resultRef) {
    resultRef.textContent = result.reference || '--';
  }
}

function showError(message) {
  showView('error');
  if (errorText) errorText.textContent = message;
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

// ============================================
// Start
// ============================================

init();
