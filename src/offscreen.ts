/**
 * Offscreen Document for Speech Recognition
 *
 * Chrome extension pages (chrome-extension:// URLs) cannot use the
 * Web Speech API directly. This offscreen document runs in a normal
 * web context where SpeechRecognition is available.
 *
 * Communication flow:
 * Side Panel → background (sendMessage) → offscreen (onMessage) → SpeechRecognition
 * SpeechRecognition → offscreen → background (sendMessage) → side panel (onMessage)
 */

export {};

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

let recognition: any = null;
let isRecording = false;
let finalTranscript = '';

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interim = transcript;
      }
    }
    // Send combined transcript back
    chrome.runtime.sendMessage({
      type: 'speechResult',
      transcript: finalTranscript + interim,
    });
  };

  recognition.onend = () => {
    if (isRecording) {
      // Browser stopped after silence, restart
      try {
        recognition.start();
      } catch {
        isRecording = false;
        chrome.runtime.sendMessage({ type: 'speechEnd' });
      }
    } else {
      chrome.runtime.sendMessage({ type: 'speechEnd' });
    }
  };

  recognition.onerror = (event: any) => {
    chrome.runtime.sendMessage({
      type: 'speechError',
      error: event.error,
    });
    if (event.error !== 'no-speech') {
      isRecording = false;
    }
  };
}

// Listen for commands from the background/side panel
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'startSpeechRecognition' && recognition) {
    isRecording = true;
    finalTranscript = '';
    try {
      recognition.start();
    } catch {
      // May already be started
    }
  } else if (msg.type === 'stopSpeechRecognition' && recognition) {
    isRecording = false;
    try {
      recognition.stop();
    } catch {
      // May already be stopped
    }
  }
});
