// Recognition frame - runs SpeechRecognition in an iframe context.
// This iframe is loaded on chrome-extension:// pages where
// SpeechRecognition needs a page context to work.

(function () {
  var statusText = document.getElementById('status-text');
  var pulseEl = document.getElementById('pulse');
  var recognition = null;
  var lastInterimTranscript = '';
  var isActive = true;

  init();

  function init() {
    try {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        showError('Speech Recognition not supported');
        sendToParent({ type: 'recognition-error', error: 'Speech Recognition not supported', recoverable: false });
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onstart = function () {
        statusText.textContent = 'Listening...';
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
        console.warn('CHAOS Recognition: Error:', event.error);
        // no-speech is normal (silence), just restart
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }
        sendToParent({ type: 'recognition-error', error: event.error, recoverable: false });
        showError(event.error);
      };

      recognition.onend = function () {
        // Restart if still active (browser stops after silence)
        if (isActive && recognition) {
          try {
            recognition.start();
          } catch (e) {
            sendToParent({ type: 'recognition-ended' });
          }
        }
      };

      recognition.start();
    } catch (err) {
      showError(err.message || String(err));
      sendToParent({ type: 'recognition-error', error: err.message || String(err), recoverable: false });
    }
  }

  function stopRecognition() {
    isActive = false;

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
      try { rec.stop(); } catch (e) {}
    }

    sendToParent({ type: 'recognition-ended' });
  }

  function showError(message) {
    statusText.textContent = 'Error: ' + message;
    statusText.classList.add('error');
    if (pulseEl) pulseEl.style.display = 'none';
  }

  function sendToParent(message) {
    window.parent.postMessage(
      Object.assign({ source: 'chaos-recognition' }, message),
      '*'
    );
  }

  // Listen for stop command from parent
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.target !== 'chaos-recognition') return;
    if (event.data.type === 'stop') {
      stopRecognition();
    }
  });

  window.addEventListener('beforeunload', function () {
    isActive = false;
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }
  });

  console.log('CHAOS Recognition Frame: Loaded, starting recognition');
})();
