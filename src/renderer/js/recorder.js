// Records the output canvas ("V"): Config.RECORD_SECONDS long, then saved as MP4 (see main/recording.js).
// Meant for teasers made at home: start an instance with e.g. --output=1080x1920 for Instagram.
// Nothing is drawn into the picture while recording; progress shows in the window title.

const Recorder = {
  active: false,
  recorder: null,
  timer: null,
  startedAt: 0,
  title: "",
};

function toggleRecording() {
  if (Recorder.active) stopRecording();
  else startRecording();
}

function startRecording() {
  const canvas = document.querySelector("#sketch-container canvas");
  if (!canvas || !canvas.captureStream) return;

  const mimeType = ["video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  const chunks = [];
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: 16_000_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    const bytes = await new Blob(chunks, { type: mimeType }).arrayBuffer();
    document.title = "Saving…";
    const result = await window.electronAPI.saveRecording(bytes);
    document.title = result && result.ok ? Recorder.title : "Recording failed";
  };

  Recorder.title = document.title;
  Recorder.startedAt = millis();
  Recorder.recorder = recorder;
  Recorder.active = true;
  recorder.start(1000);
  Recorder.timer = setInterval(updateRecording, 200);
}

function updateRecording() {
  const elapsed = (millis() - Recorder.startedAt) / 1000;
  if (elapsed >= Config.RECORD_SECONDS) return stopRecording();
  document.title = `● REC ${elapsed.toFixed(0)} / ${Config.RECORD_SECONDS} s`;
}

function stopRecording() {
  clearInterval(Recorder.timer);
  Recorder.active = false;
  Recorder.recorder.stop();
}
