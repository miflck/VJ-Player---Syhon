// Saves a screen recording from the renderer (WebM) and converts it to an MP4 that
// Instagram accepts (H.264, yuv420p, 30 fps) with ffmpeg. Without ffmpeg the WebM is kept.

const { app, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const { spawn } = require("child_process");

const FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];

function runFfmpeg(command, input, output) {
  const args = [
    "-y", "-i", input,
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow",
    "-an", "-movflags", "+faststart",
    output,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject); // ENOENT when this candidate does not exist
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

async function convertToMp4(input, output) {
  let lastError;
  for (const command of FFMPEG_CANDIDATES) {
    try {
      await runFfmpeg(command, input, output);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function timestamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function registerRecording() {
  ipcMain.handle("save-recording", async (_event, bytes) => {
    const dir = path.join(app.getPath("videos"), "VJ Player");
    await fs.mkdir(dir, { recursive: true });
    const webm = path.join(dir, `${timestamp()}.webm`);
    await fs.writeFile(webm, Buffer.from(bytes));

    const mp4 = webm.replace(/\.webm$/, ".mp4");
    try {
      await convertToMp4(webm, mp4);
      await fs.unlink(webm);
      shell.showItemInFolder(mp4);
      return { ok: true, file: mp4 };
    } catch (error) {
      console.warn("Recording could not be converted to MP4 (is ffmpeg installed?):", error.message);
      shell.showItemInFolder(webm);
      return { ok: true, file: webm, converted: false };
    }
  });
}

module.exports = { registerRecording };
