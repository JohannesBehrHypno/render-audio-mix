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

require("dotenv").config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const cors = require('cors');
app.use(cors({
  origin: "https://remarkable-frangipane-54157d.netlify.app",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.get('/ping', (req, res) => {
  res.send('pong');
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
      .getPublicUrl(`/Rauchfrei_Hypnose${id}.mp3`);

    res.json({ url: publicUrlData.publicUrl });
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
