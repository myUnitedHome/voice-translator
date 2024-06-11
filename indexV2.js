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

// ----






document.getElementById('form').addEventListener('submit', async (event) => {
  console.log('Form submitted.');
  event.preventDefault();

  const formData = new FormData(event.target);
  let deepgramKey = formData.get('deepgram_key');
  let openAiKey = formData.get('openai_key');



  apiGladiaDiv.classList.add('hidden');
  apiOpenAIDiv.classList.add('hidden');
  keysAndDevice.classList.add('centered');
  deviceItem.classList.add('device');


  let formMovedToTop = false;

  const initialSubmitButtonContent = submitButton.innerHTML;

  // Update the UI
  submitButton.setAttribute('disabled', 'true');
  submitButton.textContent = 'Waiting for connection...';
  resultContainer.style.display = 'none';
  finalsContainer.textContent = '';


  const stop = () => {
    submitButton.removeAttribute('disabled');
    submitButton.style.display = 'block';

    submitButton.innerHTML = initialSubmitButtonContent;

    stopButton.setAttribute('disabled', 'true');
    stopButton.style.backgroundColor = '';
    stopButton.style.color = '';
    stopButton.removeEventListener('click', stop);

    if (socket) {
      socket.close();
    }
  };



  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    console.log('Media stream obtained.');
    const socket = new WebSocket('wss://api.deepgram.com/v1/listen', ['token', deepgramKey]);

    socket.onopen = () => {
      console.log('WebSocket connection established.');

      // document.getElementById('status').textContent = 'Connected';


      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorder.addEventListener('dataavailable', async (event) => {
        if (event.data.size > 0 && socket.readyState == 1) {
          socket.send(event.data);
        }
      });

      mediaRecorder.start(1000);
    };

    socket.onmessage = async (message) => {
      const received = JSON.parse(message.data);
      const transcript = received.channel.alternatives[0].transcript;
      console.log('Transcript:', transcript);

      if (transcript && received.is_final) {
        const translation = await getTranslation(transcript, openAiKey, true);
        if (translation)
          document.getElementById('transcript').textContent += translation + ' ';
      }
    };

    socket.onclose = () => {
      document.getElementById('status').textContent = 'Disconnected';
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    document.querySelector('button[type="button"]').addEventListener('click', () => {
      mediaRecorder.stop();
      stream.getTracks().forEach(track => track.stop());
      socket.close();
    });
  });


  submitButton.textContent = 'Recording...';

  stopButton.removeAttribute('disabled');
  stopButton.style.backgroundColor = '#d94242';
  stopButton.style.color = '#fff';
  stopButton.addEventListener('click', stop);

  resultContainer.style.display = 'block';

  if (!formMovedToTop) {
    form.style.position = 'absolute';
    form.style.top = '10px';
    form.style.left = '10px';
    form.style.transform = 'translateY(0)';
    formMovedToTop = true;
  }
});

const getTranslation = async (text, openAiKey, stream) => {
  let baseUrl = 'https://api.openai.com/v1';
  let model = 'gpt-4o';

  let prompt = 'You an English to Spanish Translator, reply ONLY with the translation to spanish of the text, the words United Roofing toghether are the only exception dont Translate them Just write United Roofing, also all the you that you read in the transcript is for an audience so translate this into plural in spanish the verbs and everything';

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