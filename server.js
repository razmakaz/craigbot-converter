const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = 3000;

// Initialize SQLite database
const db = new sqlite3.Database(":memory:");
db.serialize(() => {
  db.run(
    "CREATE TABLE files (id TEXT PRIMARY KEY, status TEXT, outputPath TEXT)"
  );
});

// Set up Multer for file uploads
const upload = multer({ dest: "uploads/" });

// WebSocket server setup
const wss = new WebSocket.Server({ noServer: true });

function sendProgress(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ progress: message }));
  }
}

app.use(express.static("public"));

// Handle the form submission
app.post("/upload", upload.single("zipfile"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const zipPath = req.file.path;
  const baseOutputFileName = req.body.baseOutputFileName || "output";
  const outputDirectory = "extracted_files";
  const outputFolder = "output";
  const outputFolderPath = path.resolve(outputFolder);
  const fileId = req.file.filename;

  // Save initial file processing status to the database
  db.run(
    "INSERT INTO files (id, status) VALUES (?, ?)",
    [fileId, "processing"],
    (err) => {
      if (err) {
        return res.status(500).send("Error saving to database.");
      }
      res.json({ message: "File received", fileId });
    }
  );

  // Process the ZIP file
  processZipFile(
    zipPath,
    baseOutputFileName,
    outputDirectory,
    outputFolderPath,
    fileId
  );
});

function processZipFile(
  zipPath,
  baseOutputFileName,
  outputDirectory,
  outputFolderPath,
  fileId
) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outputDirectory, true);

  const flacFiles = fs
    .readdirSync(outputDirectory)
    .filter((file) => file.endsWith(".flac"));

  if (flacFiles.length === 0) {
    db.run("UPDATE files SET status = ? WHERE id = ?", [
      "no flac files found",
      fileId,
    ]);
    return;
  }

  const inputs = flacFiles
    .map((file) => `-i "${path.join(outputDirectory, file)}"`)
    .join(" ");
  const inputLabels = flacFiles.map((file, index) => `[${index}:a]`).join("");
  const amixPart = `amix=inputs=${flacFiles.length}:duration=longest`;
  const filterComplex = `${inputLabels} ${amixPart},acompressor=threshold=0.3:ratio=4:attack=50:release=1000,alimiter=level_in=1.0:level_out=0.9:limit=0.8:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11[audio]`;

  const tempOutputFilePath = path.join(
    outputFolderPath,
    `${baseOutputFileName}_temp.mp3`
  );
  const ffmpegCommand = `ffmpeg ${inputs} -filter_complex "${filterComplex}" -map "[audio]" -acodec libmp3lame -ar 22050 -ab 40k "${tempOutputFilePath}"`;

  const ffmpegProcess = exec(ffmpegCommand, (error, stdout, stderr) => {
    if (error) {
      db.run("UPDATE files SET status = ? WHERE id = ?", [
        "ffmpeg failed",
        fileId,
      ]);
      return;
    }

    const fileSizeMB = fs.statSync(tempOutputFilePath).size / (1024 * 1024);
    if (fileSizeMB > 50) {
      const splitCommand = `ffmpeg -i "${tempOutputFilePath}" -f segment -segment_time 2700 -c copy "${outputFolderPath}/${baseOutputFileName}-%03d.mp3"`;

      exec(splitCommand, (splitError, splitStdout, splitStderr) => {
        if (splitError) {
          db.run("UPDATE files SET status = ? WHERE id = ?", [
            "split failed",
            fileId,
          ]);
          return;
        }

        fs.unlinkSync(tempOutputFilePath);
        db.run("UPDATE files SET status = ?, outputPath = ? WHERE id = ?", [
          "split",
          path.join(outputFolderPath, `${baseOutputFileName}-%03d.mp3`),
          fileId,
        ]);
      });
    } else {
      const finalOutputFilePath = path.join(
        outputFolderPath,
        `${baseOutputFileName}.mp3`
      );
      fs.renameSync(tempOutputFilePath, finalOutputFilePath);
      db.run("UPDATE files SET status = ?, outputPath = ? WHERE id = ?", [
        "completed",
        finalOutputFilePath,
        fileId,
      ]);
    }
  });

  ffmpegProcess.stdout.on("data", (data) => {
    wss.clients.forEach((ws) => sendProgress(ws, data.toString()));
  });

  ffmpegProcess.stderr.on("data", (data) => {
    wss.clients.forEach((ws) => sendProgress(ws, data.toString()));
  });
}

// WebSocket upgrade handler
app.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Endpoint to check processing status
app.get("/status/:fileId", (req, res) => {
  const fileId = req.params.fileId;
  db.get("SELECT status FROM files WHERE id = ?", [fileId], (err, row) => {
    if (err) {
      return res.status(500).send("Error fetching status.");
    }
    if (!row) {
      return res.status(404).send("File not found.");
    }
    res.json({ status: row.status });
  });
});

// Endpoint to download the processed file
app.get("/download/:fileId", (req, res) => {
  const fileId = req.params.fileId;
  db.get("SELECT outputPath FROM files WHERE id = ?", [fileId], (err, row) => {
    if (err) {
      return res.status(500).send("Error fetching file path.");
    }
    if (!row || !row.outputPath) {
      return res.status(404).send("File not found or not processed.");
    }
    res.download(row.outputPath);
  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
