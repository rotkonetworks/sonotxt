// API base URL
const API_BASE = 'https://api.sonotxt.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sonotxt-speak',
    title: 'Listen with SonoTxt (Alt+S)',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'sonotxt-page',
    title: 'Listen to this page',
    contexts: ['page']
  });
});

// handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'speak-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // get selected text from content script
    chrome.tabs.sendMessage(tab.id, { type: 'getSelection' }, async (response) => {
      if (chrome.runtime.lastError || !response?.text) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'error',
          message: 'Select some text first'
        });
        return;
      }
      await processText(tab.id, response.text);
    });
  }

  if (command === 'stop-audio') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'stop' });
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sonotxt-speak' && info.selectionText) {
    await processText(tab.id, info.selectionText);
  }
  if (info.menuItemId === 'sonotxt-page') {
    await processUrl(tab.id, tab.url);
  }
});

async function processText(tabId, text) {
  text = text.trim();
  if (text.length === 0) return;

  const { apiKey, voice } = await chrome.storage.local.get(['apiKey', 'voice']);
  const charCount = text.length;

  // step 1: submitting
  chrome.tabs.sendMessage(tabId, {
    type: 'processing',
    step: 'Submitting...',
    text: `${charCount.toLocaleString()} characters`
  });

  try {
    const job = await submitTtsJob(apiKey, text, voice || 'af_bella');

    // step 2: generating (with free tier info if applicable)
    const subtitle = job.free_tier_remaining !== undefined
      ? `${job.free_tier_remaining.toLocaleString()} free chars left today`
      : `${charCount.toLocaleString()} characters`;

    chrome.tabs.sendMessage(tabId, {
      type: 'processing',
      step: 'Generating audio...',
      text: subtitle
    });

    const audio = await pollForCompletion(apiKey, job.job_id, tabId);

    chrome.tabs.sendMessage(tabId, {
      type: 'ready',
      audioUrl: audio.url,
      duration: audio.duration_seconds,
      cost: job.estimated_cost,
      freeRemaining: job.free_tier_remaining,
      cached: audio.wasCached
    });
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      type: 'error',
      message: error.message || 'Failed to generate audio'
    });
  }
}

async function processUrl(tabId, url) {
  if (!url || !url.startsWith('http')) {
    chrome.tabs.sendMessage(tabId, {
      type: 'error',
      message: 'Cannot extract content from this page'
    });
    return;
  }

  // step 1: extracting
  chrome.tabs.sendMessage(tabId, {
    type: 'processing',
    step: 'Reading page...',
    text: new URL(url).hostname
  });

  try {
    const extractResponse = await fetch(`${API_BASE}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!extractResponse.ok) {
      const error = await extractResponse.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to extract content');
    }

    const extracted = await extractResponse.json();

    if (!extracted.text || extracted.text.length < 10) {
      throw new Error('No readable content found on this page');
    }

    // show what we found
    chrome.tabs.sendMessage(tabId, {
      type: 'processing',
      step: 'Content extracted',
      text: `${extracted.char_count.toLocaleString()} chars · ${extracted.word_count} words`
    });

    await sleep(400); // brief pause to show the extracted info

    // now process the text
    await processText(tabId, extracted.text);

  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      type: 'error',
      message: error.message || 'Failed to process page'
    });
  }
}

async function submitTtsJob(apiKey, text, voice) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, voice })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 402) {
      throw new Error('Insufficient balance. Please add credits.');
    }
    if (response.status === 429 && error.hint) {
      throw new Error(`${error.error}\n${error.hint}`);
    }
    throw new Error(error.error || 'Failed to submit job');
  }

  return response.json();
}

async function pollForCompletion(apiKey, jobId, tabId, maxAttempts = 60) {
  let lastStatus = '';
  const startTime = Date.now();

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1000);

    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${API_BASE}/status?job_id=${jobId}`, { headers });

    if (!response.ok) continue;

    const result = await response.json();

    if (result.status === 'Complete') {
      // if completed in < 2s, it was likely cached
      const elapsed = Date.now() - startTime;
      result.wasCached = elapsed < 2000;
      return result;
    }

    if (result.status === 'Failed') {
      throw new Error(result.reason || 'Processing failed');
    }

    // update status if changed (show processing step)
    if (tabId && result.status !== lastStatus) {
      lastStatus = result.status;
      const stepText = result.status === 'Processing' ? 'Generating audio...' : result.status;
      chrome.tabs.sendMessage(tabId, {
        type: 'processing',
        step: stepText,
        text: i > 5 ? 'Almost ready...' : ''
      });
    }
  }

  throw new Error('Timeout waiting for audio generation');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getBalance') {
    getBalance(message.apiKey).then(sendResponse);
    return true;
  }
  if (message.type === 'getVoices') {
    getVoices().then(sendResponse);
    return true;
  }
  if (message.type === 'processPage') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (tab) {
        await processUrl(tab.id, tab.url);
      }
    });
    return false;
  }
  if (message.type === 'extractUrl') {
    extractUrl(message.url).then(sendResponse);
    return true;
  }
  if (message.type === 'speakText') {
    // from selection tooltip - sender.tab has the tab info
    if (sender.tab) {
      processText(sender.tab.id, message.text);
    }
    return false;
  }
});

async function getVoices() {
  try {
    const response = await fetch(`${API_BASE}/voices`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function getBalance(apiKey) {
  try {
    const response = await fetch(`${API_BASE}/billing/status`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function extractUrl(url) {
  try {
    const response = await fetch(`${API_BASE}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { error: error.error || 'Failed to extract' };
    }

    return response.json();
  } catch {
    return { error: 'Network error' };
  }
}
