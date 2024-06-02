const SAMPLE_RATE = 48000;
const useGROQ = false;

/**
 * @returns {{promise: Promise<any>; resolve(value: any): void; reject(err: any): void;}}
 */
function deferredPromise() {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

const getTranslation = async (text, openAiKey) => {
  let baseUrl = 'https://api.openai.com/v1';
  if (useGROQ) {
    // not working
    baseUrl = 'https://api.groq.com/openai/v1';
  }
  const url = `${baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You an English to Spanish Translator, reply ONLY with the translation to spanish of the text, the words United Roofing toghether are the only exception dont Translate them Just write United Roofing, also all the you that you read in the transcript is for an audience so translate this into plural in spanish the verbs and everything',
        },
        {
          role: 'user',
          content: `${text}`,
        },
      ],
      model: 'gpt-4o',
    }),
  });

  const result = await response.json();
  return result.choices[0].message.content.trim();
};

// Initialize the audio input devices
async function listAudioDevices() {
  /** @type {HTMLSelectElement} */
  const inputDeviceSelect = document.querySelector(
    'select[name="input_device"]'
  );

  if (window.location.protocol === 'file:') {
    const audioDevices = await navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => devices.filter((d) => d.kind === 'audioinput'));
    if (!audioDevices.length) {
      window.alert('No audio input device found');
      return;
    }

    console.log(
      'Cannot list audio input devices since you are running the file locally. We will use your default audio input.'
    );
    const option = document.createElement('option');
    option.textContent = 'Default';
    option.value = '';
    inputDeviceSelect.appendChild(option);
    inputDeviceSelect.value = '';
    return;
  }

  // Ask the permissions to the user
  const media = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  // Stop all the tracks now that we have the user permission
  media.getTracks().forEach((track) => track.stop());

  const audioDevices = await navigator.mediaDevices
    .enumerateDevices()
    .then((devices) =>
      devices.filter((d) => d.kind === 'audioinput' && d.deviceId)
    );

  if (!audioDevices.length) {
    window.alert('No audio input device found');
    return;
  }

  inputDeviceSelect.innerHTML = '';
  audioDevices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label ?? 'Default';
    inputDeviceSelect.appendChild(option);
  });
  inputDeviceSelect.value = audioDevices[0]?.deviceId ?? '';
  inputDeviceSelect.removeAttribute('disabled');
}
listAudioDevices();

/** @type {HTMLFormElement} */
const form = document.querySelector('#form');
/** @type {HTMLButtonElement} */
const submitButton = document.querySelector('button[type="submit"]');
/** @type {HTMLButtonElement} */
const stopButton = document.querySelector('button[type="button"]');
/** @type {HTMLDivElement} */
const resultContainer = document.querySelector('#result');
/** @type {HTMLSpanElement} */
const finalsContainer = document.querySelector('#finals');
/** @type {HTMLSpanElement} */
const partialsContainer = document.querySelector('#partials');

form.addEventListener('submit', async (evt) => {
  evt.preventDefault();

  // Parse submitted data
  const formData = new FormData(form);
  const gladiaKey = formData.get('gladia_key');
  const openAiKey = formData.get('openai_key');

  const inputDevice = formData.get('input_device');

  let formMovedToTop = false;

  // Guardar el contenido inicial del botón "Start"
  const initialSubmitButtonContent = submitButton.innerHTML;

  // Update the UI
  submitButton.setAttribute('disabled', 'true');
  submitButton.textContent = 'Waiting for connection...';
  resultContainer.style.display = 'none';
  finalsContainer.textContent = '';
  partialsContainer.textContent = '...';

  /** @type {MediaStream | undefined} */
  let audioStream;
  /** @type {RecordRTC | undefined} */
  let recorder;
  /** @type {WebSocket | undefined} */
  let socket;

  const stop = () => {
    submitButton.removeAttribute('disabled');
    submitButton.style.display = 'block';

    submitButton.innerHTML = initialSubmitButtonContent;

    stopButton.setAttribute('disabled', 'true');
    stopButton.style.backgroundColor = '';
    stopButton.style.color = '';
    stopButton.removeEventListener('click', stop);

    recorder?.destroy();
    audioStream?.getTracks().forEach((track) => track.stop());
    if (socket) {
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.close();
    }
  };

  try {
    const socketPromise = deferredPromise();

    // Initializes the websocket
    socket = new WebSocket(
      'wss://api.gladia.io/audio/text/audio-transcription'
    );
    socket.onopen = () => {
      // Check https://docs.gladia.io/reference/live-audio for more information about the parameters
      const configuration = {
        x_gladia_key: gladiaKey,
        frames_format: 'bytes',
        language_behaviour: 'automatic single language',
        sample_rate: SAMPLE_RATE,
        translation: true,
      };
      socket.send(JSON.stringify(configuration));
    };
    socket.onerror = () => {
      socketPromise.reject(new Error(`Couldn't connect to the server`));
    };
    socket.onclose = (event) => {
      socketPromise.reject(
        new Error(
          `Server refuses the connection: [${event.code}] ${event.reason}`
        )
      );
    };
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        socketPromise.reject(
          new Error(`Cannot parse the message: ${event.data}`)
        );
      }

      if (data?.event === 'connected') {
        socketPromise.resolve(true);
      } else {
        socketPromise.reject(
          new Error(`Server sent an unexpected message: ${event.data}`)
        );
      }
    };

    // Get the input stream
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: inputDevice ? { deviceId: { exact: inputDevice } } : true,
    });

    // Initializes the recorder
    recorder = new RecordRTC(audioStream, {
      type: 'audio',
      mimeType: 'audio/wav',
      recorderType: RecordRTC.StereoAudioRecorder,
      timeSlice: 1000,
      async ondataavailable(blob) {
        const buffer = await blob.arrayBuffer();
        // Remove WAV header
        const modifiedBuffer = buffer.slice(44);
        socket?.send(modifiedBuffer);
      },
      sampleRate: SAMPLE_RATE,
      desiredSampRate: SAMPLE_RATE,
      numberOfAudioChannels: 1,
    });

    await socketPromise.promise;
  } catch (err) {
    window.alert(`Error during the initialization: ${err?.message || err}`);
    console.error(err);
    stop();
    return;
  }

  // Register new listeners
  socket.onopen = null;
  socket.onerror = null;
  socket.onclose = (event) => {
    const message = `Lost connection to the server: [${event.code}] ${event.reason}`;
    window.alert(message);
    console.error(message);
    stop();
  };
  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log(data);
    if (data?.event === 'transcript' && data.transcription) {
      if (data.type === 'final') {
        // finalsContainer.textContent += data.transcription;
        // partialsContainer.textContent = '';
        // console.log("esto seria lo final", data.transcription)
        const translation = await getTranslation(data.transcription, openAiKey);
        console.log('esto seria la traduccion', translation);
        finalsContainer.textContent += translation;
        // if data.transcription finish with a . or ? or ! then we add a new line
        if (
          data.transcription.slice(-1) === '.' ||
          data.transcription.slice(-1) === '?' ||
          data.transcription.slice(-1) === '!'
        ) {
          finalsContainer.textContent += '\n';
        } else {
          finalsContainer.textContent += ' ';
        }
        partialsContainer.textContent = '';
      } else {
        partialsContainer.textContent = data.transcription + '';
      }
    }
  };

  submitButton.textContent = 'Recording...';

  stopButton.removeAttribute('disabled');
  stopButton.style.backgroundColor = '#d94242';
  stopButton.style.color = '#fff';
  stopButton.addEventListener('click', stop);

  resultContainer.style.display = 'block';

  // Start the recording
  recorder.startRecording();

  if (!formMovedToTop) {
    form.style.position = 'absolute';
    form.style.top = '10px';
    form.style.left = '10px';
    form.style.transform = 'translateY(0)';
    formMovedToTop = true;
  }
});
