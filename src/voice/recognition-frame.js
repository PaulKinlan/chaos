// Recognition frame - runs SpeechRecognition in an iframe context.
// Communicates with parent via postMessage.
//
// getUserMedia is called first to request mic permission (required on
// chrome-extension:// pages). Then SpeechRecognition is started.
// Same pattern as the utter Chrome extension.

(function () {
  var statusText = document.getElementById('status-text');
  var pulseEl = document.getElementById('pulse');

  var recognition = null;
  var micStream = null;
  var lastInterimTranscript = '';
  var isActive = true;

  // Audio feedback - resolve paths relative to this script's location
  var basePath = document.currentScript ? document.currentScript.src.replace(/[^/]*$/, '') : '';
  var beepAudio = new Audio(basePath + 'beep.wav');
  var boopAudio = new Audio(basePath + 'boop.wav');
  beepAudio.volume = 0.3;
  boopAudio.volume = 0.3;

  function playBeep() { beepAudio.play().catch(function() {}); }
  function playBoop() { boopAudio.play().catch(function() {}); }

  init();

  async function init() {
    try {
      // Request mic permission first (required on chrome-extension:// pages)
      // This triggers the browser's permission prompt
      statusText.textContent = 'Requesting mic...';
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        // getUserMedia failed - try starting recognition anyway
        // (may work on some pages without explicit mic permission)
        console.warn('getUserMedia failed, trying recognition directly:', micErr);
      }
      startRecognition();
    } catch (err) {
      showError(err.message || String(err));
      sendToParent({ type: 'recognition-error', error: err.message || String(err), recoverable: false });
    }
  }

  function startRecognition() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('Speech Recognition not supported in this browser');
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onstart = function () {
      statusText.textContent = 'Listening...';
      playBeep();
      sendToParent({ type: 'recognition-started' });
    };

    recognition.onresult = function (event) {
      var interimTranscript = '';
      var finalTranscript = '';

      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        lastInterimTranscript = interimTranscript;
        statusText.textContent = interimTranscript.slice(0, 40) + (interimTranscript.length > 40 ? '...' : '');
      }
      if (finalTranscript) {
        lastInterimTranscript = '';
        statusText.textContent = 'Listening...';
      }

      sendToParent({
        type: 'recognition-result',
        finalTranscript: finalTranscript,
        interimTranscript: interimTranscript,
      });
    };

    recognition.onerror = function (event) {
      console.warn('CHAOS Recognition Frame: Error:', event.error);

      // no-speech and aborted are normal - recognition auto-restarts via onend
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // not-allowed means mic permission denied
      if (event.error === 'not-allowed') {
        showError('Microphone access denied');
        sendToParent({ type: 'recognition-error', error: 'Microphone access denied. Check your browser permissions.', recoverable: false });
        isActive = false;
        return;
      }

      sendToParent({
        type: 'recognition-error',
        error: event.error,
        recoverable: false,
      });
      showError(event.error);
    };

    recognition.onend = function () {
      // Restart if still active (browser stops after silence periods)
      if (isActive && recognition) {
        try {
          recognition.start();
        } catch (e) {
          sendToParent({ type: 'recognition-ended' });
        }
      }
    };

    recognition.start();
  }

  function stopRecognition() {
    isActive = false;
    playBoop();

    // Send any pending interim text as final
    if (lastInterimTranscript) {
      sendToParent({
        type: 'recognition-result',
        finalTranscript: lastInterimTranscript,
        interimTranscript: '',
      });
      lastInterimTranscript = '';
    }

    if (recognition) {
      var rec = recognition;
      recognition = null;
      try {
        rec.stop();
      } catch (e) {
        // already stopped
      }
    }

    sendToParent({ type: 'recognition-ended' });
  }

  function showError(message) {
    statusText.textContent = 'Error: ' + message;
    statusText.classList.add('error');
    pulseEl.style.display = 'none';
  }

  function sendToParent(message) {
    window.parent.postMessage(
      Object.assign({ source: 'chaos-recognition' }, message),
      '*'
    );
  }

  // Listen for messages from parent
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.target !== 'chaos-recognition') return;

    switch (event.data.type) {
      case 'stop':
        stopRecognition();
        break;
    }
  });

  // Clean up on unload
  window.addEventListener('beforeunload', function () {
    isActive = false;
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(function(t) { t.stop(); });
      micStream = null;
    }
  });

  console.log('CHAOS Recognition Frame: Loaded');
})();
