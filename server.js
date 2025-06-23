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

const cors = require("cors");

const allowedOrigins = [
  "https://hypnize.com",
  "https://www.hypnize.com", // optional, falls irgendwann mit www
  "https://remarkable-frangipane-54157d.netlify.app" // falls noch im Test
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.get("/ping", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // oder deine Domains explizit
  res.status(200).send("ready");
});

app.get("/download/:filename", async (req, res) => {
  const { filename } = req.params;

  const { data, error } = await supabase
    .storage
    .from("hypnosis-audio")
    .download(filename);

  const buffer = await data.arrayBuffer();

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

    console.log("📦 Speech-File size:", fs.statSync(speechPath).size);
    console.log("🎵 Music-File size:", fs.statSync(musicPath).size);

    // Lade Musik wie gehabt herunter
    const response = await fetch(musicUrl);
    console.log(response);
    const fileStream = fs.createWriteStream(musicPath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    const header = fs.readFileSync(musicPath, { encoding: "utf-8", flag: "r" }).slice(0, 100);
    console.log("📄 File head:", header);

    // Führe ffmpeg aus
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-i", speechPath,
          "-i", musicPath,
          "-filter_complex", "[0:a]adelay=7000|7000[s];[1:a]volume=0.15[m];[s][m]amix=inputs=2:duration=longest",
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

    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.json({ filename: filename, url: publicUrlData?.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/mix-blobs", upload.fields([{ name: "speech" }, { name: "music" }]), async (req, res) => {
  try {
    const speechBuffer = req.files.speech?.[0]?.buffer;
    const musicBuffer = req.files.music?.[0]?.buffer;

    if (!speechBuffer || !musicBuffer) {
      return res.status(400).json({ error: "Beide Dateien (speech, music) müssen gesendet werden." });
    }

    const id = uuidv4();
    const tmpDir = os.tmpdir();
    const speechPath = path.join(tmpDir, `${id}_speech.mp3`);
    const musicPath = path.join(tmpDir, `${id}_music.mp3`);
    const outputPath = path.join(tmpDir, `${id}_output.mp3`);

    fs.writeFileSync(speechPath, speechBuffer);
    fs.writeFileSync(musicPath, musicBuffer);

    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-i", speechPath,
          "-i", musicPath,
          "-filter_complex", "[0:a]adelay=7000|7000[s];[1:a]volume=0.15[m];[s][m]amix=inputs=2:duration=longest",
          "-c:a", "libmp3lame",
          "-y", outputPath
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const fileBuffer = fs.readFileSync(outputPath);
    const filename = `Rauchfrei_Hypnose_${id}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from("hypnosis-audio")
      .upload(filename, fileBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase
      .storage
      .from("hypnosis-audio")
      .getPublicUrl(filename);

    res.json({ filename, url: publicUrlData?.publicUrl });
  } catch (err) {
    console.error("Mixing über Blobs fehlgeschlagen:", err);
    res.status(500).json({ error: err.message });
  }
});

// In server.js hinzufügen
const { SMTPClient } = require("emailjs"); // falls noch nicht installiert: npm install emailjs

app.post("/send-access-email", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Session ID fehlt" });

    const { data: purchase, error } = await supabase
      .from("purchases")
      .select("*")
      .eq("stripe_session_id", sessionId)
      .eq("status", "completed")
      .single();

    if (error || !purchase) {
      return res.status(404).json({ error: "Kein Kauf gefunden" });
    }

    const accessUrl = `https://hypnize.com/access/${purchase.access_token}`;

    const client = new SMTPClient({
      user: "support@hypnize.com",
      password: process.env.ZOHO_SMTP_PASSWORD,
      host: "smtp.zoho.eu",
      ssl: false,
      tls: true,
      port: 587,
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb; text-align: center;">Der Link zu Deiner Hypnose ist bereit!</h1>
        <p>Hallo,</p>
        <p>vielen Dank für Deinen Kauf! Deine personalisierte Rauchfrei-Hypnose kann jetzt erstellt werden.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${accessUrl}" style="background: linear-gradient(to right, #16a34a, #2563eb); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Zur Hypnose-Erstellung
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Falls der Button nicht funktioniert, kopiere diesen Link in Deinen Browser:<br><a href="${accessUrl}" style="color: #2563eb;">${accessUrl}</a></p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px; text-align: center;">Bei Fragen stehen wir Dir gerne zur Verfügung.</p>
      </div>
    `;

    await client.sendAsync({
      from: "Hypnize Support <support@hypnize.com>",
      to: purchase.email,
      subject: "Deine Rauchfrei-Hypnose ist bereit generiert zu werden",
      attachment: [{ data: html, alternative: true }],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Fehler beim Senden der Mail:", err);
    res.status(500).json({ error: "E-Mail-Versand fehlgeschlagen" });
  }
});

app.post("/send-success-email", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: "Access Token fehlt" });

    const { data: purchase, error } = await supabase
      .from("purchases")
      .select("*")
      .eq("access_token", accessToken)
      .eq("status", "completed")
      .single();

    if (error || !purchase) {
      return res.status(404).json({ error: "Kein Kauf gefunden" });
    }

    const accessUrl = `https://hypnize.com/access/${purchase.access_token}`;

    const client = new SMTPClient({
      user: "support@hypnize.com",
      password: process.env.ZOHO_SMTP_PASSWORD,
      host: "smtp.zoho.eu",
      ssl: false,
      tls: true,
      port: 587,
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #16a34a; text-align: center;">Deine Hypnose ist fertig!</h1>
        <p>Hallo,</p>
        <p>Deine personalisierte Hypnose wurde erfolgreich erstellt. Du kannst sie jetzt anhören oder herunterladen:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${accessUrl}" style="background: linear-gradient(to right, #16a34a, #2563eb); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Hypnose anhören
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Falls der Button nicht funktioniert, kopiere diesen Link in Deinen Browser:<br><a href="${accessUrl}" style="color: #2563eb;">${accessUrl}</a></p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px; text-align: center;">Bei Fragen stehen wir Dir gerne zur Verfügung.</p>
      </div>
    `;

    await client.sendAsync({
      from: "Hypnize Support <support@hypnize.com>",
      to: purchase.email,
      subject: "Deine personalisierte Hypnose ist fertig!",
      attachment: [{ data: html, alternative: true }],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Fehler beim Senden der Erfolgs-Mail:", err);
    res.status(500).json({ error: "E-Mail-Versand fehlgeschlagen" });
  }
});

app.post("/mix-urls", async (req, res) => {
  try {
    const { speechUrl, musicUrl, filename } = req.body;
    if (!speechUrl || !musicUrl) {
      return res.status(400).json({ error: "speechUrl und musicUrl sind erforderlich" });
    }

    const id = uuidv4();
    const tmpDir = os.tmpdir();
    const speechPath = path.join(tmpDir, `${id}_speech.mp3`);
    const musicPath = path.join(tmpDir, `${id}_music.mp3`);
    const outputPath = path.join(tmpDir, `${id}_output.mp3`);

    // Lade Speech
    const speechResponse = await fetch(speechUrl);
    const speechStream = fs.createWriteStream(speechPath);
    await new Promise((resolve, reject) => {
      speechResponse.body.pipe(speechStream);
      speechResponse.body.on("error", reject);
      speechStream.on("finish", resolve);
    });

console.log("🔊 Downloading music from:", musicUrl)

    // Lade Musik
    const musicResponse = await fetch(musicUrl);
    const musicStream = fs.createWriteStream(musicPath);
    await new Promise((resolve, reject) => {
      musicResponse.body.pipe(musicStream);
      musicResponse.body.on("error", reject);
      musicStream.on("finish", resolve);
    });

console.log("💾 Saved music to:", musicPath)

    // Mixen
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-i", speechPath,
          "-i", musicPath,
          "-filter_complex", "[0:a]adelay=7000|7000[s];[1:a]volume=0.15[m];[s][m]amix=inputs=2:duration=longest",
          "-c:a", "libmp3lame",
          "-y", outputPath
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Upload zu Supabase
    const fileBuffer = fs.readFileSync(outputPath);
    const finalFilename = filename || `Rauchfrei_Hypnose_${id}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from("hypnosis-audio")
      .upload(finalFilename, fileBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase
      .storage
      .from("hypnosis-audio")
      .getPublicUrl(finalFilename);

    res.json({ filename: finalFilename, url: publicUrlData?.publicUrl });
  } catch (err) {
    console.error("Mixing über URLs fehlgeschlagen:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
