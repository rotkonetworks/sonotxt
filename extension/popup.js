document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveKey');
  const listenPageBtn = document.getElementById('listenPage');
  const statusMsgEl = document.getElementById('statusMsg');
  const statusBadge = document.getElementById('statusBadge');
  const balanceDisplay = document.getElementById('balanceDisplay');
  const voiceSelect = document.getElementById('voice');

  const { apiKey, voice } = await chrome.storage.local.get(['apiKey', 'voice']);

  // load voices
  await loadVoices(voice);

  if (apiKey) {
    apiKeyInput.value = apiKey;
    statusBadge.textContent = 'Pro';
    statusBadge.classList.remove('free');
    await loadBalance(apiKey);
  } else {
    balanceDisplay.textContent = '1000 chars/day free';
    balanceDisplay.classList.remove('hidden');
  }

  listenPageBtn.addEventListener('click', async () => {
    listenPageBtn.disabled = true;
    listenPageBtn.innerHTML = `
      <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
      </svg>
      Loading...
    `;
    // add spin animation
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }';
    document.head.appendChild(style);

    chrome.runtime.sendMessage({ type: 'processPage' });
    window.close();
  });

  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();

    // clear key = go back to free tier
    if (!key) {
      await chrome.storage.local.remove('apiKey');
      showStatus('Using free tier', 'success');
      statusBadge.textContent = 'Free';
      statusBadge.classList.add('free');
      balanceDisplay.textContent = '1000 chars/day free';
      balanceDisplay.classList.remove('hidden');
      return;
    }

    saveBtn.textContent = '...';
    saveBtn.disabled = true;

    const balance = await chrome.runtime.sendMessage({
      type: 'getBalance',
      apiKey: key
    });

    if (balance) {
      await chrome.storage.local.set({ apiKey: key });
      showStatus('Saved', 'success');
      statusBadge.textContent = 'Pro';
      statusBadge.classList.remove('free');
      balanceDisplay.textContent = `Balance: $${balance.balance.toFixed(2)}`;
      balanceDisplay.classList.remove('hidden');
    } else {
      showStatus('Invalid key', 'error');
    }

    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
  });

  voiceSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ voice: voiceSelect.value });
  });

  async function loadBalance(key) {
    const balance = await chrome.runtime.sendMessage({
      type: 'getBalance',
      apiKey: key
    });

    if (balance) {
      balanceDisplay.textContent = `Balance: $${balance.balance.toFixed(2)}`;
      balanceDisplay.classList.remove('hidden');
    }
  }

  async function loadVoices(selectedVoice) {
    const data = await chrome.runtime.sendMessage({ type: 'getVoices' });

    if (!data || !data.categories) return;

    voiceSelect.innerHTML = '';

    const labels = {
      american_female: 'US Female',
      american_male: 'US Male',
      british_female: 'UK Female',
      british_male: 'UK Male',
      japanese: 'Japanese',
      chinese: 'Chinese'
    };

    for (const [category, voices] of Object.entries(data.categories)) {
      const group = document.createElement('optgroup');
      group.label = labels[category] || category;

      for (const v of voices) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = formatVoiceName(v);
        if (v === (selectedVoice || data.default)) {
          option.selected = true;
        }
        group.appendChild(option);
      }

      voiceSelect.appendChild(group);
    }
  }

  function formatVoiceName(voice) {
    const name = voice.split('_')[1];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function showStatus(message, type) {
    statusMsgEl.textContent = message;
    statusMsgEl.className = `status-msg ${type}`;
    statusMsgEl.classList.remove('hidden');

    setTimeout(() => {
      statusMsgEl.classList.add('hidden');
    }, 2500);
  }
});
