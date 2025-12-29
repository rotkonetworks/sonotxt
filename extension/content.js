let playerElement = null;
let currentAudio = null;
let tooltipElement = null;
let selectedText = '';

// show tooltip when text is selected
document.addEventListener('mouseup', (e) => {
  // small delay to let selection finalize
  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // hide if no selection or clicking on our UI
    if (!text || e.target.closest('.sonotxt-tooltip, .sonotxt-player, .sonotxt-notification')) {
      hideTooltip();
      return;
    }

    // need at least 10 chars to be useful
    if (text.length < 10) {
      hideTooltip();
      return;
    }

    selectedText = text;
    showTooltip(selection);
  }, 10);
});

// hide tooltip on click elsewhere
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.sonotxt-tooltip')) {
    hideTooltip();
  }
});

// hide on scroll
document.addEventListener('scroll', hideTooltip, { passive: true });

function showTooltip(selection) {
  hideTooltip();

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  tooltipElement = document.createElement('div');
  tooltipElement.className = 'sonotxt-tooltip';
  tooltipElement.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
    Listen
  `;

  // position above selection
  tooltipElement.style.left = `${rect.left + window.scrollX + rect.width / 2 - 40}px`;
  tooltipElement.style.top = `${rect.top + window.scrollY - 40}px`;

  tooltipElement.addEventListener('click', () => {
    hideTooltip();
    chrome.runtime.sendMessage({ type: 'speakText', text: selectedText });
  });

  document.body.appendChild(tooltipElement);
}

function hideTooltip() {
  if (tooltipElement) {
    tooltipElement.remove();
    tooltipElement = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'getSelection':
      const selection = window.getSelection().toString().trim();
      sendResponse({ text: selection });
      return true;

    case 'processing':
      showNotification({
        title: message.step || 'Generating audio',
        subtitle: message.text,
        type: 'processing'
      });
      break;

    case 'ready':
      // brief success notification before showing player
      showNotification({
        title: message.cached ? 'Cached!' : 'Ready!',
        subtitle: message.duration ? `${Math.round(message.duration)}s audio` : '',
        type: 'success'
      });
      setTimeout(() => {
        hideNotification();
        showPlayer(message.audioUrl, message.duration);
      }, message.cached ? 400 : 600);
      break;

    case 'error':
      showNotification({
        title: 'Error',
        subtitle: message.message,
        type: 'error'
      });
      setTimeout(hideNotification, 4000);
      break;

    case 'stop':
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      if (playerElement) {
        playerElement.remove();
        playerElement = null;
      }
      hideNotification();
      break;
  }
});

function showNotification({ title, subtitle, type }) {
  hideNotification();

  const notification = document.createElement('div');
  notification.id = 'sonotxt-notification';
  notification.className = `sonotxt-notification${type === 'error' ? ' sonotxt-error' : ''}`;

  let icon = '';
  if (type === 'processing') {
    icon = '<div class="sonotxt-spinner"></div>';
  } else if (type === 'success') {
    icon = `<div class="sonotxt-check">
      <svg viewBox="0 0 24 24" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </div>`;
  }

  notification.innerHTML = `
    ${icon}
    <div class="sonotxt-notification-content">
      <div class="sonotxt-notification-title">${title}</div>
      ${subtitle ? `<div class="sonotxt-notification-sub">${subtitle}</div>` : ''}
    </div>
  `;

  document.body.appendChild(notification);
}

function hideNotification() {
  const existing = document.getElementById('sonotxt-notification');
  if (existing) existing.remove();
}

function showPlayer(audioUrl, duration) {
  if (playerElement) playerElement.remove();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  playerElement = document.createElement('div');
  playerElement.id = 'sonotxt-player';
  playerElement.className = 'sonotxt-player';

  playerElement.innerHTML = `
    <button class="sonotxt-play-btn" aria-label="Play">
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path class="play-icon" d="M8 5v14l11-7z" fill="currentColor"/>
        <path class="pause-icon" d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" style="display:none"/>
      </svg>
    </button>
    <div class="sonotxt-progress">
      <div class="sonotxt-progress-bar"></div>
    </div>
    <span class="sonotxt-time">0:00 / ${formatTime(duration)}</span>
    <select class="sonotxt-speed">
      <option value="0.75">0.75x</option>
      <option value="1" selected>1x</option>
      <option value="1.25">1.25x</option>
      <option value="1.5">1.5x</option>
      <option value="2">2x</option>
    </select>
    <button class="sonotxt-close" aria-label="Close">&times;</button>
  `;

  document.body.appendChild(playerElement);

  currentAudio = new Audio(audioUrl);

  const playBtn = playerElement.querySelector('.sonotxt-play-btn');
  const playIcon = playerElement.querySelector('.play-icon');
  const pauseIcon = playerElement.querySelector('.pause-icon');
  const progressBar = playerElement.querySelector('.sonotxt-progress-bar');
  const progressContainer = playerElement.querySelector('.sonotxt-progress');
  const timeDisplay = playerElement.querySelector('.sonotxt-time');
  const speedSelect = playerElement.querySelector('.sonotxt-speed');
  const closeBtn = playerElement.querySelector('.sonotxt-close');

  playBtn.addEventListener('click', () => {
    if (currentAudio.paused) {
      currentAudio.play();
    } else {
      currentAudio.pause();
    }
  });

  currentAudio.addEventListener('play', () => {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  });

  currentAudio.addEventListener('pause', () => {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  });

  currentAudio.addEventListener('timeupdate', () => {
    const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
    progressBar.style.width = `${progress}%`;
    timeDisplay.textContent = `${formatTime(currentAudio.currentTime)} / ${formatTime(currentAudio.duration)}`;
  });

  progressContainer.addEventListener('click', (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    currentAudio.currentTime = pos * currentAudio.duration;
  });

  speedSelect.addEventListener('change', () => {
    currentAudio.playbackRate = parseFloat(speedSelect.value);
  });

  closeBtn.addEventListener('click', () => {
    currentAudio.pause();
    currentAudio = null;
    playerElement.remove();
    playerElement = null;
  });

  currentAudio.addEventListener('ended', () => {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  });

  // Auto-play
  currentAudio.play().catch(() => {});
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
