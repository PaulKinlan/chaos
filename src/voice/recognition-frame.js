// Recognition frame - runs SpeechRecognition in an iframe context.
// Communicates with parent via postMessage.

(function () {
  const statusText = document.getElementById('status-text');
  const pulseEl = document.getElementById('pulse');

  let recognition = null;
  let micStream = null;
  let lastInterimTranscript = '';

  init();

  async function init() {
    try {
      await startRecognition();
    } catch (err) {
      showError(err.message);
    }
  }

  async function startRecognition() {
    // Request mic access - this is what makes the iframe approach work
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('Speech Recognition not supported');
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
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        lastInterimTranscript = interimTranscript;
      }
      if (finalTranscript) {
        lastInterimTranscript = '';
      }

      sendToParent({
        type: 'recognition-result',
        finalTranscript: finalTranscript,
        interimTranscript: interimTranscript,
      });
    };

    recognition.onerror = function (event) {
      console.warn('CHAOS Recognition Frame: Error:', event.error);

      // no-speech and aborted are normal - just restart via onend
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Don't even tell the parent about no-speech - it's just silence
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
      // Restart if still active (browser stops after silence)
      if (recognition) {
        try {
          recognition.start();
        } catch (e) {
          sendToParent({ type: 'recognition-ended' });
          cleanup();
        }
      }
    };

    recognition.start();
  }

  function stopRecognition() {
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
    cleanup();
  }

  function cleanup() {
    if (micStream) {
      micStream.getTracks().forEach(function (track) {
        track.stop();
      });
      micStream = null;
    }
    recognition = null;
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
    cleanup();
  });

  console.log('CHAOS Recognition Frame: Loaded');
})();
