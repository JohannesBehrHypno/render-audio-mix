// server.js
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");
const ffmpegPath = "ffmpeg"; // system binary
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const upload = multer();

require("dotenv").config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const cors = require('cors');
app.use(cors({
  origin: ["https://remarkable-frangipane-54157d.netlify.app", "https://hypnize.com"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.sendStatus(204);
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.get("/ping", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // oder deine Domains explizit
  res.status(200).send("pong");
});

app.post("/mix", async (req, res) => {
  try {
    const { speechUrl, musicUrl } = req.body;

    const id = uuidv4();
    const tmpDir = os.tmpdir();
    const speechPath = path.join(tmpDir, `${id}_speech.mp3`);
    const musicPath = path.join(tmpDir, `${id}_music.mp3`);
    const outputPath = path.join(tmpDir, `${id}_output.mp3`);

    const download = async (url, dest) => {
      const response = await fetch(url);
      const fileStream = fs.createWriteStream(dest);
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on("error", reject);
        fileStream.on("finish", resolve);
      });
    };

    await download(speechUrl, speechPath);
    await download(musicUrl, musicPath);

    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-i", speechPath,
          "-i", musicPath,
          "-filter_complex", "[0:a]adelay=7000|7000[s];[1:a]volume=0.15[m];[s][m]amix=inputs=2:duration=first",
          "-c:a", "libmp3lame",
          "-y", outputPath
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const fileBuffer = fs.readFileSync(outputPath);
    const { data, error } = await supabase.storage
      .from("hypnosis-audio")
      .upload(`/Rauchfrei_Hypnose_${id}.mp3`, fileBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase
      .storage
      .from("hypnosis-audio")
      .getPublicUrl(`/Rauchfrei_Hypnose_${id}.mp3`);

    res.json({ url: publicUrlData.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/download/:filename", async (req, res) => {
  const { filename } = req.params;

  const { data, error } = await supabase
    .storage
    .from("hypnosis-audio")
    .download(filename);

  if (error || !data) {
    res.setHeader("Access-Control-Allow-Origin", "https://remarkable-frangipane-54157d.netlify.app");
    res.set('Access-Control-Allow-Origin', 'https://hypnize.com');
    return res.status(500).json({ error: "Download fehlgeschlagen" });
  }

  const buffer = await data.arrayBuffer();
  res.setHeader("Access-Control-Allow-Origin", "https://remarkable-frangipane-54157d.netlify.app", 'https://hypnize.com');
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

app.post("/mix-blob", upload.single("speech"), async (req, res) => {
  try {
    const musicUrl = req.body.musicUrl;
    const speechBuffer = req.file.buffer;

    const id = uuidv4();
    const tmpDir = os.tmpdir();
    const speechPath = path.join(tmpDir, `${id}_speech.mp3`);
    const musicPath = path.join(tmpDir, `${id}_music.mp3`);
    const outputPath = path.join(tmpDir, `${id}_output.mp3`);

    // Speichere Speech-Buffer lokal
    fs.writeFileSync(speechPath, speechBuffer);

    // Lade Musik wie gehabt herunter
    const response = await fetch(musicUrl);
    const fileStream = fs.createWriteStream(musicPath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    // Führe ffmpeg aus
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-i", speechPath,
          "-i", musicPath,
          "-filter_complex", "[0:a]adelay=7000|7000[s];[1:a]volume=0.15[m];[s][m]amix=inputs=2:duration=first",
          "-c:a", "libmp3lame",
          "-y", outputPath
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Hochladen zu Supabase
    const fileBuffer = fs.readFileSync(outputPath);
    const filename = `Rauchfrei_Hypnose_${id}.mp3`;
    const { data, error } = await supabase.storage
      .from("hypnosis-audio")
      .upload(`/${filename}`, fileBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase
      .storage
      .from("hypnosis-audio")
      .getPublicUrl(`/Rauchfrei_Hypnose_${id}.mp3`);

    res.set('Access-Control-Allow-Origin', 'https://remarkable-frangipane-54157d.netlify.app', 'https://hypnize.com');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.json({ filename: filename, url: publicUrlData?.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Audio mixer running on port ${PORT}`);
});

// .env.example
// SUPABASE_URL=https://yourproject.supabase.co
// SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
