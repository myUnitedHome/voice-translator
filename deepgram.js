// Specifies the sample rate of the audio in Hz. Valid values are 8000, 16000, 32000, 44100, and 48000. default value is 16000
const SAMPLE_RATE = 48000; // Baja el sample rate si la latencia es más crítica que la calidad

const MAX_LINES = 4;

const USE_GROQ = false;
const USE_STREAM = true;
const TIME_SLICE = 200; // Intervalo más corto para fragmentos de audio

const FINAL_CONFIDENCE = 0.6; // if the confidence final is lower than this we are not using the transcription, in some cases the noise generate random transcriptions with low confidence


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

const getTranslation = async (text, openAiKey, stream) => {
  let baseUrl = 'https://api.openai.com/v1';
  let model = 'gpt-4o';

  if (USE_GROQ) {
    baseUrl = 'https://api.groq.com/openai/v1';
    model = 'llama3-8b-8192';
  }

  let prompt = 'You are an English to Spanish translator. Reply ONLY with the Spanish translation of the text. Do not translate "United Roofing," write it as is. Translate "you" in the text to the plural form in Spanish (verbs and everything).';

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
          content: prompt,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      model,
      stream
    }),
  });

  if (response.ok && stream) {
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) return;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let dataDone = false;
      const arr = value.split('\n');
      arr.forEach((data) => {
        if (data.length === 0) return; // ignore empty message
        if (data.startsWith(':')) return; // ignore sse comment message
        if (data === 'data: [DONE]') {
          dataDone = true;
          finalsContainer.textContent += '\n';
          return;
        }
        const json = JSON.parse(data.substring(6));
        // console.log(json);
        // console.log(json.choices[0].delta);
        // console.log(json.choices[0].delta.content);
        const translation = json.choices[0].delta.content;
        if (translation)
          finalsContainer.textContent += translation;
      });
      if (dataDone) break;
    }
  } else if (response.ok) {
    const result = await response.json();
    return result.choices[0].message.content.trim();
  }
};


function checkAndResetContainer(container) {
  const lines = container.textContent.split('\n');
  if (lines.length >= MAX_LINES) {
    container.textContent = ''; // Limpiar el contenido del contenedor solo cuando se superen las 4 líneas
  }
}

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

const recordingIndicator = document.querySelector('#recordingIndicator');
/** @type {HTMLButtonElement} */
const clearButton = document.querySelector('#clearButton');
/** @type {HTMLDivElement} */
const resultContainer = document.querySelector('#result');
/** @type {HTMLSpanElement} */
const finalsContainer = document.querySelector('#finals');
/** @type {HTMLSpanElement} */
const partialsContainer = document.querySelector('#partials');
/** @type {HTMLInputGroupElement} */
const apiGladiaDiv = document.querySelector('#apiglad');
const apiOpenAIDiv = document.querySelector('#openapi');
/** @type {HTMLSelectGroupElement} */
const deviceItem = document.querySelector('#deviceitem');

const keysAndDevice = document.querySelector('.keys-and-device');

form.addEventListener('submit', async (evt) => {
  evt.preventDefault();

  apiGladiaDiv.classList.add('hidden');
  apiOpenAIDiv.classList.add('hidden');
  keysAndDevice.classList.add('centered');
  deviceItem.classList.add('device');

  // Parse submitted data
  const formData = new FormData(form);
  let deepgramKey = formData.get('deepgram_key');
  let openAiKey = formData.get('openai_key');





  const inputDevice = formData.get('input_device');

  let formMovedToTop = false;
  const partialWords = [];

  // Guardar el contenido inicial del botón "Start"
  const initialSubmitButtonContent = submitButton.innerHTML;

  // Update the UI
  submitButton.setAttribute('disabled', 'true');
  submitButton.textContent = 'Waiting for connection...';
  resultContainer.style.display = 'none';
  finalsContainer.textContent = '';
  // partialsContainer.textContent = '...';

  /** @type {MediaStream | undefined} */
  let audioStream;
  /** @type {RecordRTC | undefined} */
  let recorder;
  /** @type {WebSocket | undefined} */
  let socket;

  clearButton.addEventListener('click', () => {
    // Limpia el contenido de los contenedores de texto
    finalsContainer.textContent = '';
    partialsContainer.textContent = '';
  });

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
      `wss://api.deepgram.com/v1/listen`,
      [
        'token',
        deepgramKey,
      ]

    );
    socket.onopen = () => {
      socketPromise.resolve(true);
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

    // Get the input stream
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: inputDevice ? { deviceId: { exact: inputDevice } } : true,
    });

    recorder = new RecordRTC(audioStream, {
      type: 'audio',
      mimeType: 'audio/wav',
      timeSlice: TIME_SLICE, // Intervalo más corto para fragmentos de audio
      async ondataavailable(blob) {
        const buffer = await blob.arrayBuffer();
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

  let lastPartial = '';

  socket.onmessage = async (event) => {
    //const data = JSON.parse(event.data);
    //console.log(data);
    const received = JSON.parse(message.data)
    const transcript = received.channel.alternatives[0].transcript

    if (transcript && received.is_fina) {
        const translation = await getTranslation(transcript, openAiKey, USE_STREAM);
        if (translation) {
          finalsContainer.textContent += translation + '\n';
        }
        partialsContainer.textContent = '';
        if (data.channel.alternatives[0].transcript.includes(lastPartial)) {
          partialsContainer.textContent = '';
          lastPartial = '';
        }

    } else {
      if (data.channel.alternatives[0].confidence >= FINAL_CONFIDENCE) {
        lastPartial = data.channel.alternatives[0].transcript;
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
