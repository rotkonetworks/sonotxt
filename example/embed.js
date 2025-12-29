/**
 * SonoTxt Blog Embed
 *
 * Usage:
 * 1. Add this script to your page:
 *    <script src="https://cdn.sonotxt.com/embed.js"></script>
 *
 * 2. Add the widget where you want the player:
 *    <div class="sonotxt-player" data-selector="article"></div>
 *
 * That's it! Works out of the box with 1000 free chars/day.
 *
 * Options (data attributes on script tag):
 *   data-api-key: Your API key (optional - for higher limits)
 *   data-voice: Voice to use (default: af_bella)
 *   data-auto: Auto-generate on load (default: false)
 *
 * Options (data attributes on player div):
 *   data-selector: CSS selector for content to convert (default: article, .post-content, main)
 *   data-text: Direct text to convert (overrides selector)
 *   data-url: URL to fetch and convert (for external content)
 */
(function() {
  'use strict';

  const SCRIPT = document.currentScript;
  const API_BASE = SCRIPT?.dataset?.apiBase || 'https://api.sonotxt.com';
  const API_KEY = SCRIPT?.dataset?.apiKey || '';
  const DEFAULT_VOICE = SCRIPT?.dataset?.voice || 'af_bella';
  const AUTO_GENERATE = SCRIPT?.dataset?.auto === 'true';

  const POLL_INTERVAL = 1500;
  const MAX_POLLS = 120; // 3 minutes max

  const STYLES = `
    .sonotxt-widget {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 12px;
      padding: 16px 20px;
      margin: 20px 0;
      color: #fff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }

    .sonotxt-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .sonotxt-logo {
      width: 32px;
      height: 32px;
      background: #6c5ce7;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sonotxt-logo svg {
      width: 20px;
      height: 20px;
    }

    .sonotxt-title {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
    }

    .sonotxt-duration {
      font-size: 12px;
      color: rgba(255,255,255,0.6);
    }

    .sonotxt-controls {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .sonotxt-play {
      width: 48px;
      height: 48px;
      background: #6c5ce7;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      transition: transform 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    .sonotxt-play:hover {
      background: #5b4cdb;
      transform: scale(1.05);
    }

    .sonotxt-play:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .sonotxt-play svg {
      width: 20px;
      height: 20px;
    }

    .sonotxt-progress-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sonotxt-progress {
      height: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      cursor: pointer;
      overflow: hidden;
    }

    .sonotxt-progress-bar {
      height: 100%;
      background: #6c5ce7;
      width: 0%;
      transition: width 0.1s linear;
      border-radius: 3px;
    }

    .sonotxt-times {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: rgba(255,255,255,0.5);
    }

    .sonotxt-speed {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .sonotxt-speed:focus {
      outline: none;
      border-color: #6c5ce7;
    }

    .sonotxt-status {
      text-align: center;
      padding: 20px;
      color: rgba(255,255,255,0.7);
      font-size: 14px;
    }

    .sonotxt-status.error {
      color: #e74c3c;
    }

    .sonotxt-generate {
      background: #6c5ce7;
      border: none;
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 auto;
      transition: background 0.15s;
    }

    .sonotxt-generate:hover {
      background: #5b4cdb;
    }

    .sonotxt-generate:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .sonotxt-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: sonotxt-spin 0.8s linear infinite;
    }

    @keyframes sonotxt-spin {
      to { transform: rotate(360deg); }
    }
  `;

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    headphones: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C7 1 3 5 3 10v7a3 3 0 003 3h1v-8H5v-2c0-4 3-7 7-7s7 3 7 7v2h-2v8h1a3 3 0 003-3v-7c0-5-4-9-9-9z"/></svg>',
    bars: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 8h2v8H4zM8 5h2v14H8zM12 10h2v4h-2zM16 6h2v12h-2z"/></svg>'
  };

  class SonoTxtWidget {
    constructor(element) {
      this.element = element;
      this.audio = null;
      this.jobId = null;
      this.polls = 0;
      this.state = 'idle'; // idle, loading, ready, playing, paused

      this.injectStyles();
      this.render();

      if (AUTO_GENERATE) {
        this.generate();
      }
    }

    injectStyles() {
      if (document.getElementById('sonotxt-styles')) return;
      const style = document.createElement('style');
      style.id = 'sonotxt-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    async getContent() {
      // direct text takes priority
      if (this.element.dataset.text) {
        return this.element.dataset.text;
      }

      // fetch from URL if specified
      if (this.element.dataset.url) {
        const extracted = await this.extractUrl(this.element.dataset.url);
        if (extracted && extracted.text) {
          return extracted.text;
        }
        throw new Error(extracted?.error || 'Failed to fetch URL content');
      }

      // try selector on current page
      const selector = this.element.dataset.selector || 'article, .post-content, .entry-content, main';
      const contentEl = document.querySelector(selector);
      if (contentEl) {
        return contentEl.innerText;
      }

      return null;
    }

    async extractUrl(url) {
      try {
        const response = await fetch(`${API_BASE}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return { error: err.error || `HTTP ${response.status}` };
        }

        return response.json();
      } catch {
        return { error: 'Network error' };
      }
    }

    render() {
      this.element.innerHTML = '';
      this.element.className = 'sonotxt-widget';

      if (this.state === 'idle') {
        this.renderGenerateButton();
      } else if (this.state === 'loading') {
        this.renderLoading();
      } else if (this.state === 'error') {
        this.renderError();
      } else {
        this.renderPlayer();
      }
    }

    renderGenerateButton() {
      // for URL mode, we can't preview char count without fetching
      const hasUrl = !!this.element.dataset.url;
      let charCount = 0;
      let estimatedMinutes = 0;

      if (!hasUrl) {
        // direct text or selector - can preview
        const text = this.element.dataset.text;
        if (text) {
          charCount = text.length;
        } else {
          const selector = this.element.dataset.selector || 'article, .post-content, .entry-content, main';
          const contentEl = document.querySelector(selector);
          if (contentEl) {
            charCount = contentEl.innerText.length;
          }
        }
        estimatedMinutes = Math.ceil(charCount / 1000);
      }

      this.element.innerHTML = `
        <div class="sonotxt-header">
          <div class="sonotxt-logo">${ICONS.bars}</div>
          <span class="sonotxt-title">Listen to this article</span>
          ${charCount > 0 ? `<span class="sonotxt-duration">~${estimatedMinutes} min</span>` : ''}
        </div>
        <button class="sonotxt-generate">
          ${ICONS.headphones}
          <span>Generate Audio</span>
        </button>
      `;

      this.element.querySelector('.sonotxt-generate').onclick = () => this.generate();
    }

    renderLoading() {
      this.element.innerHTML = `
        <div class="sonotxt-status">
          <div class="sonotxt-spinner" style="margin: 0 auto 12px;"></div>
          Generating audio...
        </div>
      `;
    }

    renderError() {
      this.element.innerHTML = `
        <div class="sonotxt-status error">
          ${this.errorMessage || 'Failed to generate audio'}
          <br><br>
          <button class="sonotxt-generate" style="margin-top:8px">Try Again</button>
        </div>
      `;
      this.element.querySelector('.sonotxt-generate').onclick = () => this.generate();
    }

    renderPlayer() {
      this.element.innerHTML = `
        <div class="sonotxt-header">
          <div class="sonotxt-logo">${ICONS.bars}</div>
          <span class="sonotxt-title">Listen to this article</span>
        </div>
        <div class="sonotxt-controls">
          <button class="sonotxt-play">${ICONS.play}</button>
          <div class="sonotxt-progress-container">
            <div class="sonotxt-progress">
              <div class="sonotxt-progress-bar"></div>
            </div>
            <div class="sonotxt-times">
              <span class="sonotxt-current">0:00</span>
              <span class="sonotxt-total">0:00</span>
            </div>
          </div>
          <select class="sonotxt-speed">
            <option value="0.75">0.75x</option>
            <option value="1" selected>1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="1.75">1.75x</option>
            <option value="2">2x</option>
          </select>
        </div>
      `;

      this.bindPlayerEvents();
    }

    bindPlayerEvents() {
      const playBtn = this.element.querySelector('.sonotxt-play');
      const progress = this.element.querySelector('.sonotxt-progress');
      const progressBar = this.element.querySelector('.sonotxt-progress-bar');
      const currentTime = this.element.querySelector('.sonotxt-current');
      const totalTime = this.element.querySelector('.sonotxt-total');
      const speedSelect = this.element.querySelector('.sonotxt-speed');

      playBtn.onclick = () => {
        if (this.audio.paused) {
          this.audio.play();
        } else {
          this.audio.pause();
        }
      };

      this.audio.onplay = () => {
        playBtn.innerHTML = ICONS.pause;
        this.state = 'playing';
      };

      this.audio.onpause = () => {
        playBtn.innerHTML = ICONS.play;
        this.state = 'paused';
      };

      this.audio.onended = () => {
        playBtn.innerHTML = ICONS.play;
        this.state = 'ready';
      };

      this.audio.onloadedmetadata = () => {
        totalTime.textContent = this.formatTime(this.audio.duration);
      };

      this.audio.ontimeupdate = () => {
        const pct = (this.audio.currentTime / this.audio.duration) * 100;
        progressBar.style.width = pct + '%';
        currentTime.textContent = this.formatTime(this.audio.currentTime);
      };

      progress.onclick = (e) => {
        const rect = progress.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.audio.currentTime = pct * this.audio.duration;
      };

      speedSelect.onchange = () => {
        this.audio.playbackRate = parseFloat(speedSelect.value);
      };
    }

    async generate() {
      let content;
      try {
        content = await this.getContent();
      } catch (err) {
        this.state = 'error';
        this.errorMessage = err.message;
        this.render();
        return;
      }

      if (!content || content.trim().length === 0) {
        this.state = 'error';
        this.errorMessage = 'No content found to convert';
        this.render();
        return;
      }

      this.state = 'loading';
      this.render();

      try {
        // build headers - API key is optional (free tier works without it)
        const headers = { 'Content-Type': 'application/json' };
        if (API_KEY) {
          headers['Authorization'] = `Bearer ${API_KEY}`;
        }

        // submit job
        const response = await fetch(`${API_BASE}/tts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: content.trim(),
            voice: DEFAULT_VOICE
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (err.hint) {
            throw new Error(`${err.error} (${err.hint})`);
          }
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const job = await response.json();
        this.jobId = job.job_id;

        // show remaining free tier chars if applicable
        if (job.free_tier_remaining !== undefined) {
          console.log(`SonoTxt: ${job.free_tier_remaining} free chars remaining today`);
        }

        // poll for completion
        await this.pollCompletion();

      } catch (err) {
        this.state = 'error';
        this.errorMessage = err.message;
        this.render();
      }
    }

    async pollCompletion() {
      this.polls = 0;

      while (this.polls < MAX_POLLS) {
        this.polls++;
        await this.sleep(POLL_INTERVAL);

        try {
          const response = await fetch(`${API_BASE}/status?job_id=${this.jobId}`, {
            headers: {
              'Authorization': `Bearer ${API_KEY}`
            }
          });

          if (!response.ok) continue;

          const status = await response.json();

          if (status.status === 'Complete') {
            this.audio = new Audio(status.url);
            this.state = 'ready';
            this.render();
            return;
          }

          if (status.status === 'Failed') {
            throw new Error(status.reason || 'Processing failed');
          }

        } catch (err) {
          // keep polling on network errors
        }
      }

      throw new Error('Timeout waiting for audio');
    }

    formatTime(seconds) {
      if (!seconds || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }
  }

  // auto-init on DOMContentLoaded
  function init() {
    document.querySelectorAll('.sonotxt-player, [data-sonotxt]').forEach(el => {
      if (!el._sonotxt) {
        el._sonotxt = new SonoTxtWidget(el);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // expose for manual init
  window.SonoTxt = SonoTxtWidget;
})();
