/**
 * SonoTxt Embed Widget
 *
 * Admin mode (free tier, domain-signed):
 *   <script src="https://app.sonotxt.com/embed.js" data-sig="ADMIN_SIG"></script>
 *
 * User mode (billed to user account):
 *   <script src="https://app.sonotxt.com/embed.js" data-user="nickname" data-sig="USER_SIG"></script>
 *
 * Then add data-sonotxt to any element:
 *   <article data-sonotxt>...</article>
 */
(function() {
  'use strict';

  const API = 'https://api.sonotxt.com';
  const script = document.currentScript;
  const sig = script?.getAttribute('data-sig') || '';
  const user = script?.getAttribute('data-user') || '';
  const selector = script?.getAttribute('data-selector') || '[data-sonotxt]';

  if (!sig) {
    console.error('[sonotxt] missing data-sig');
    return;
  }

  // state
  let state = 'idle'; // idle, checking, generating, ready, playing, paused, error
  let audioUrl = null;
  let audio = null;
  let jobId = null;
  let expanded = false;
  let dragOffset = { x: 0, y: 0 };
  let isDragging = false;

  // cache key for this page
  const cacheKey = `sonotxt:${window.location.pathname}`;

  // styles
  const style = document.createElement('style');
  style.textContent = `
    .stxt-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: #161b22;
      border: 1px solid rgba(255,255,255,0.1);
      color: #fff;
      font: 600 12px/1 system-ui, sans-serif;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stxt-btn:hover { border-color: #be185d; }

    .stxt-light {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #6b7280;
      transition: background 0.3s, box-shadow 0.3s;
    }
    .stxt-light.checking { background: #eab308; box-shadow: 0 0 6px #eab308; }
    .stxt-light.generating { background: #eab308; animation: stxt-pulse 1s infinite; }
    .stxt-light.ready { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
    .stxt-light.playing { background: #be185d; box-shadow: 0 0 8px #be185d; animation: stxt-pulse 0.8s infinite; }
    .stxt-light.paused { background: #be185d; box-shadow: 0 0 4px #be185d; }
    .stxt-light.error { background: #ef4444; box-shadow: 0 0 6px #ef4444; }

    @keyframes stxt-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .stxt-player {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: #161b22;
      border: 1px solid rgba(255,255,255,0.1);
      font: 12px/1 system-ui, sans-serif;
      color: #fff;
      min-width: 280px;
      user-select: none;
    }
    .stxt-player.expanded {
      min-width: 360px;
    }

    .stxt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: #0d1117;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      cursor: move;
    }
    .stxt-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 11px;
    }
    .stxt-header-btns {
      display: flex;
      gap: 4px;
    }
    .stxt-header-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
      line-height: 1;
    }
    .stxt-header-btn:hover { color: #fff; }

    .stxt-body {
      padding: 12px;
    }

    .stxt-status {
      text-align: center;
      padding: 16px;
      color: rgba(255,255,255,0.6);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stxt-status-light {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin: 0 auto 8px;
    }

    .stxt-progress-wrap {
      margin-bottom: 10px;
    }
    .stxt-progress {
      height: 4px;
      background: rgba(255,255,255,0.1);
      cursor: pointer;
      position: relative;
    }
    .stxt-progress-bar {
      height: 100%;
      background: #be185d;
      width: 0%;
      transition: width 0.1s linear;
    }
    .stxt-progress-handle {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.15s;
      cursor: grab;
    }
    .stxt-progress:hover .stxt-progress-handle { opacity: 1; }

    .stxt-time {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      margin-top: 4px;
      font-variant-numeric: tabular-nums;
    }

    .stxt-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .stxt-ctrl {
      background: none;
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.15s, background 0.15s;
    }
    .stxt-ctrl:hover { border-color: #be185d; }
    .stxt-ctrl.main {
      width: 40px;
      height: 40px;
      background: #be185d;
      border-color: #be185d;
    }
    .stxt-ctrl.main:hover { background: #9f1239; border-color: #9f1239; }
    .stxt-ctrl:disabled { opacity: 0.3; cursor: not-allowed; }
    .stxt-ctrl svg { width: 16px; height: 16px; fill: currentColor; }
    .stxt-ctrl.main svg { width: 20px; height: 20px; }

    .stxt-generate {
      width: 100%;
      padding: 12px;
      background: #be185d;
      border: none;
      color: #fff;
      font: 600 12px/1 system-ui, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .stxt-generate:hover { background: #9f1239; }
    .stxt-generate:disabled { opacity: 0.5; cursor: wait; }

    .stxt-error {
      color: #ef4444;
      text-align: center;
      padding: 8px;
      font-size: 11px;
    }
  `;
  document.head.appendChild(style);

  // icons
  const icons = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>',
    skipBack: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    skipFwd: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    back10: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.31 8.9l.25-2.17h2.39v.71h-1.7l-.11.92c.03-.02.07-.03.11-.05s.09-.04.15-.05.12-.03.18-.04.13-.02.2-.02c.21 0 .39.03.55.1s.3.16.41.28.2.27.25.45.09.38.09.6c0 .19-.03.37-.09.54s-.15.32-.27.45-.27.24-.45.31-.39.12-.64.12c-.18 0-.36-.03-.53-.08s-.32-.14-.46-.24-.25-.23-.34-.39-.14-.33-.15-.53h.97c.02.13.05.24.11.32s.14.15.23.19.2.07.31.07c.13 0 .24-.03.32-.08s.16-.12.21-.21.09-.19.11-.3.03-.22.03-.34c0-.12-.01-.24-.04-.34s-.08-.2-.14-.27-.15-.14-.25-.18-.22-.06-.36-.06c-.17 0-.3.02-.41.07s-.22.12-.31.21l-.79-.11z"/></svg>',
    fwd10: '<svg viewBox="0 0 24 24"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2zm-7.46 2.22c-.06.05-.12.09-.2.12s-.17.04-.27.04c-.09 0-.17-.01-.25-.04s-.14-.06-.2-.11-.1-.1-.13-.17-.05-.14-.05-.22h-.85c0 .21.04.39.12.55s.19.28.33.38.29.18.46.23.35.07.53.07c.21 0 .41-.03.6-.08s.34-.14.48-.24.24-.24.32-.39.12-.33.12-.53c0-.23-.06-.44-.18-.61s-.3-.3-.54-.39c.1-.05.2-.1.28-.17s.15-.14.2-.22.1-.16.13-.25.04-.18.04-.27c0-.2-.04-.37-.11-.53s-.17-.28-.3-.38-.28-.18-.46-.23-.37-.08-.59-.08c-.19 0-.38.03-.54.08s-.32.13-.44.23-.23.23-.3.38-.11.33-.11.53h.85c0-.07.02-.14.05-.2s.07-.11.12-.15.11-.07.18-.1.14-.03.22-.03c.1 0 .18.01.25.04s.13.06.18.11.08.11.11.17.04.14.04.22c0 .18-.05.32-.16.43s-.26.16-.48.16h-.43v.66h.45c.11 0 .2.01.29.04s.16.06.22.11.11.12.14.2.05.18.05.29c0 .09-.01.17-.04.24s-.08.13-.13.18z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
    collapse: '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  };

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function getTextContent() {
    const el = document.querySelector(selector);
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, .stxt-btn, .stxt-player').forEach(e => e.remove());
    return clone.textContent?.trim() || '';
  }

  function setState(newState) {
    state = newState;
    updateUI();
  }

  function checkCache() {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.url && data.expires > Date.now()) {
          audioUrl = data.url;
          setState('ready');
          return true;
        }
      } catch (e) {}
      localStorage.removeItem(cacheKey);
    }
    return false;
  }

  function saveCache(url) {
    localStorage.setItem(cacheKey, JSON.stringify({
      url,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24h
    }));
  }

  // button element
  let btnEl = null;
  let playerEl = null;

  function createButton() {
    if (btnEl) return;
    btnEl = document.createElement('button');
    btnEl.className = 'stxt-btn';
    btnEl.innerHTML = `<span class="stxt-light"></span><span>sonotxt</span>`;
    btnEl.onclick = openPlayer;
    document.body.appendChild(btnEl);
    updateUI();
  }

  function updateUI() {
    if (btnEl) {
      const light = btnEl.querySelector('.stxt-light');
      light.className = 'stxt-light';
      if (state === 'checking' || state === 'generating') light.classList.add('generating');
      else if (state === 'ready') light.classList.add('ready');
      else if (state === 'playing') light.classList.add('playing');
      else if (state === 'paused') light.classList.add('paused');
      else if (state === 'error') light.classList.add('error');
    }
    if (playerEl) {
      updatePlayerUI();
    }
  }

  function openPlayer() {
    if (btnEl) {
      btnEl.remove();
      btnEl = null;
    }
    createPlayer();
  }

  function createPlayer() {
    playerEl = document.createElement('div');
    playerEl.className = 'stxt-player';
    playerEl.innerHTML = `
      <div class="stxt-header">
        <div class="stxt-brand">
          <span class="stxt-light"></span>
          <span>sonotxt</span>
        </div>
        <div class="stxt-header-btns">
          <button class="stxt-header-btn stxt-expand" title="Expand">${icons.expand}</button>
          <button class="stxt-header-btn stxt-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="stxt-body"></div>
    `;

    // drag
    const header = playerEl.querySelector('.stxt-header');
    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });

    // expand/collapse
    playerEl.querySelector('.stxt-expand').onclick = toggleExpand;
    playerEl.querySelector('.stxt-close').onclick = closePlayer;

    document.body.appendChild(playerEl);
    updatePlayerUI();
  }

  function updatePlayerUI() {
    const body = playerEl.querySelector('.stxt-body');
    const light = playerEl.querySelector('.stxt-brand .stxt-light');

    light.className = 'stxt-light';
    if (state === 'checking' || state === 'generating') light.classList.add('generating');
    else if (state === 'ready') light.classList.add('ready');
    else if (state === 'playing') light.classList.add('playing');
    else if (state === 'paused') light.classList.add('paused');
    else if (state === 'error') light.classList.add('error');

    if (state === 'idle') {
      body.innerHTML = `<button class="stxt-generate">Generate Audio</button>`;
      body.querySelector('.stxt-generate').onclick = generate;
    } else if (state === 'checking') {
      body.innerHTML = `
        <div class="stxt-status">
          <div class="stxt-status-light stxt-light checking"></div>
          Checking...
        </div>`;
    } else if (state === 'generating') {
      body.innerHTML = `
        <div class="stxt-status">
          <div class="stxt-status-light stxt-light generating"></div>
          Generating audio...
        </div>`;
    } else if (state === 'ready' || state === 'playing' || state === 'paused') {
      renderAudioControls(body);
    } else if (state === 'error') {
      body.innerHTML = `
        <div class="stxt-error">Failed to generate audio</div>
        <button class="stxt-generate">Retry</button>`;
      body.querySelector('.stxt-generate').onclick = generate;
    }
  }

  function renderAudioControls(body) {
    if (!audio) {
      audio = new Audio(audioUrl);
      audio.addEventListener('play', () => { setState('playing'); });
      audio.addEventListener('pause', () => { if (!audio.ended) setState('paused'); });
      audio.addEventListener('ended', () => { setState('ready'); });
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('loadedmetadata', updateProgress);
    }

    const progress = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;

    body.innerHTML = `
      <div class="stxt-progress-wrap">
        <div class="stxt-progress">
          <div class="stxt-progress-bar" style="width: ${progress}%"></div>
          <div class="stxt-progress-handle" style="left: ${progress}%"></div>
        </div>
        <div class="stxt-time">
          <span class="stxt-current">${formatTime(audio.currentTime)}</span>
          <span class="stxt-duration">${formatTime(audio.duration)}</span>
        </div>
      </div>
      <div class="stxt-controls">
        <button class="stxt-ctrl" data-action="back10" title="Back 10s">${icons.back10}</button>
        <button class="stxt-ctrl" data-action="stop" title="Stop">${icons.stop}</button>
        <button class="stxt-ctrl main" data-action="playpause" title="${state === 'playing' ? 'Pause' : 'Play'}">
          ${state === 'playing' ? icons.pause : icons.play}
        </button>
        <button class="stxt-ctrl" data-action="fwd10" title="Forward 10s">${icons.fwd10}</button>
      </div>`;

    // progress seek
    const progressEl = body.querySelector('.stxt-progress');
    progressEl.addEventListener('click', seekProgress);

    // controls
    body.querySelectorAll('.stxt-ctrl').forEach(btn => {
      btn.onclick = () => handleControl(btn.dataset.action);
    });
  }

  function updateProgress() {
    if (!playerEl || !audio) return;
    const bar = playerEl.querySelector('.stxt-progress-bar');
    const handle = playerEl.querySelector('.stxt-progress-handle');
    const current = playerEl.querySelector('.stxt-current');
    const duration = playerEl.querySelector('.stxt-duration');

    if (bar && audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      bar.style.width = pct + '%';
      if (handle) handle.style.left = pct + '%';
    }
    if (current) current.textContent = formatTime(audio.currentTime);
    if (duration) duration.textContent = formatTime(audio.duration);
  }

  function seekProgress(e) {
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  function handleControl(action) {
    if (!audio) return;
    switch (action) {
      case 'playpause':
        if (audio.paused) audio.play();
        else audio.pause();
        break;
      case 'stop':
        audio.pause();
        audio.currentTime = 0;
        setState('ready');
        break;
      case 'back10':
        audio.currentTime = Math.max(0, audio.currentTime - 10);
        break;
      case 'fwd10':
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
        break;
    }
  }

  function toggleExpand() {
    expanded = !expanded;
    playerEl.classList.toggle('expanded', expanded);
    const btn = playerEl.querySelector('.stxt-expand');
    btn.innerHTML = expanded ? icons.collapse : icons.expand;
  }

  function closePlayer() {
    if (audio) {
      audio.pause();
      audio = null;
    }
    playerEl.remove();
    playerEl = null;
    createButton();
  }

  // drag functionality
  function startDrag(e) {
    if (e.target.closest('.stxt-header-btn')) return;
    isDragging = true;
    const touch = e.touches?.[0] || e;
    const rect = playerEl.getBoundingClientRect();
    dragOffset.x = touch.clientX - rect.left;
    dragOffset.y = touch.clientY - rect.top;

    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', stopDrag);
    e.preventDefault();
  }

  function drag(e) {
    if (!isDragging) return;
    const touch = e.touches?.[0] || e;
    const x = touch.clientX - dragOffset.x;
    const y = touch.clientY - dragOffset.y;

    playerEl.style.left = x + 'px';
    playerEl.style.top = y + 'px';
    playerEl.style.right = 'auto';
    playerEl.style.bottom = 'auto';
    e.preventDefault();
  }

  function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', drag);
    document.removeEventListener('touchend', stopDrag);
  }

  async function generate() {
    const text = getTextContent();
    if (!text) {
      alert('No content found');
      return;
    }
    if (text.length > 5000) {
      alert('Content too long (max 5000 chars)');
      return;
    }

    setState('generating');

    try {
      const endpoint = user ? `${API}/embed/user-tts` : `${API}/embed/tts`;
      const payload = user ? { text, sig, user } : { text, sig };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }

      const { job_id } = await res.json();
      jobId = job_id;
      audioUrl = await pollJob(job_id);
      saveCache(audioUrl);
      setState('ready');
    } catch (e) {
      console.error('[sonotxt]', e);
      setState('error');
    }
  }

  async function pollJob(id) {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const res = await fetch(`${API}/embed/status?job_id=${id}`);
      const data = await res.json();

      if (data.status === 'Complete' && data.url) {
        return data.url;
      }
      if (data.status === 'Failed') {
        throw new Error(data.error || 'Generation failed');
      }
    }
    throw new Error('Timeout');
  }

  // init
  function init() {
    checkCache();
    createButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
