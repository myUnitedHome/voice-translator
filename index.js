// Specifies the sample rate of the audio in Hz. Valid values are 8000, 16000, 32000, 44100, and 48000. default value is 16000
const SAMPLE_RATE = 48000; // Baja el sample rate si la latencia es más crítica que la calidad

const MAX_LINES = 7;
const USE_GROQ = false;
const USE_STREAM = true;
const TIME_SLICE = 300; // Intervalo más corto para fragmentos de audio
const FINAL_CONFIDENCE = 0.7; // if the confidence final is lower than this we are not using the transcription, in some cases the noise generate random transcriptions with low confidence

const ENDPOINTING = 100; //duration of silence which will cause the utterance to be considered finished and a result of type ‘final’ to be sent.
const AUDIO_ENHANCER = true;

let selectedLanguage = 'Spanish'; // Valor por defecto

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

  let prompt =
    'You an English to Spanish Translator, reply ONLY with the translation to spanish of the text, the words United Roofing toghether are the only exception dont Translate them Just write United Roofing, also all the you that you read in the transcript is for an audience so translate this into plural in spanish the verbs and everything';

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
      stream,
    }),
  });

  if (response.ok && stream) {
    const reader = response.body
      ?.pipeThrough(new TextDecoderStream())
      .getReader();
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
        if (translation) finalsContainer.textContent += translation;
      });
      if (dataDone) break;
    }
  } else if (response.ok) {
    const result = await response.json();
    return result.choices[0].message.content.trim();
  }
};

// function checkAndResetContainer(container) {
//   const lines = container.textContent.split('\n');
//   if (lines.length >= MAX_LINES) {
//     setTimeout(() => {
//       container.textContent = ''; // Limpiar el contenido del contenedor
//     }, 10000); // Esperar 3 segundos antes de limpiar la pantalla
//   }
// }

function handleLanguageChange() {
  const languageSelect = document.getElementById('language');
  selectedLanguage = languageSelect.value;
  console.log(`Language selected: ${selectedLanguage}`);
}

function checkAndResetContainer(container) {
  console.log('Checking container');
  const lines = container.textContent.split('\n');
  console.log(lines.length);
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
  let gladiaKey = formData.get('gladia_key');
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
      'wss://api.gladia.io/audio/text/audio-transcription'
    );
    socket.onopen = () => {
      // Check https://docs.gladia.io/reference/live-audio for more information about the parameters
      // const configuration = {
      //   x_gladia_key: gladiaKey,
      //   frames_format: 'bytes',
      //   language_behaviour: 'manual',
      //   language: 'english',
      //   sample_rate: SAMPLE_RATE,
      //   translation: true,
      // };
      const configuration = {
        x_gladia_key: gladiaKey,
        frames_format: 'bytes',
        language_behaviour: 'manual',
        language: 'english',
        sample_rate: SAMPLE_RATE,
        translation: selectedLanguage === 'Spanish' ? true : false,
      };
      console.log('configuration', configuration);
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

    recorder = new RecordRTC(audioStream, {
      type: 'audio',
      mimeType: 'audio/wav',
      // mimeType: 'audio/webm;codecs=opus',
      recorderType: RecordRTC.StereoAudioRecorder,
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
    document.querySelector('#loading').style.display = 'inline-block';
    const data = JSON.parse(event.data);
    console.log('DATA', data);
    if (data?.event === 'transcript' && data.transcription) {
      if (data.type === 'final' && data.confidence >= FINAL_CONFIDENCE) {
        if (selectedLanguage === 'Spanish') {
          const translation = await getTranslation(
            data.transcription,
            openAiKey,
            USE_STREAM
          );
          if (translation) {
            //empty finalsContiner if we have a lot of lines
            checkAndResetContainer(finalsContainer);

            finalsContainer.textContent += translation + '\n';
          }
          partialsContainer.textContent = '';
          if (data.transcription.includes(lastPartial)) {
            partialsContainer.textContent = '';
            lastPartial = '';
          }
        } else {
          // For English, just transcribe without translation
          finalsContainer.textContent += data.transcription + '\n';
          partialsContainer.textContent = '';
        }

        document.querySelector('#loading').style.display = 'none';

        // const translation = await getTranslation(
        //   data.transcription,
        //   openAiKey,
        //   USE_STREAM
        // );
        // if (translation) {
        //   //empty finalsContiner if we have a lot of lines
        //   checkAndResetContainer(finalsContainer);

        //   finalsContainer.textContent += translation + '\n';
        // }
        // partialsContainer.textContent = '';
        // if (data.transcription.includes(lastPartial)) {
        //   partialsContainer.textContent = '';
        //   lastPartial = '';
        // }

        // document.querySelector('#loading').style.display = 'none';
      } else if (data.type === 'partial' && data.confidence >= 0.8) {
        // lastPartial = data.transcription;
        // partialsContainer.textContent = await getTranslation(
        //   data.transcription,
        //   openAiKey
        // );
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
