// server/nodeServer.js
import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8100;

// ===============================
// 1) Servir carpeta pública
// ===============================
app.use(express.static(path.join(__dirname, "../public")));

app.listen(PORT, () => {
    console.log(`🌍 Servidor web en http://localhost:${PORT}`);
});

// ===============================
// 2) Arrancar servidor Python
// ===============================
console.log("🚀 Arrancando servidor Python SGP4...");

const pythonProcess = spawn("python3", ["server.py"], {
    cwd: path.join(__dirname, "./python"),
});

pythonProcess.stdout.on("data", (data) => {
    console.log("[PYTHON]", data.toString());
});

pythonProcess.stderr.on("data", (data) => {
    console.error("[PYTHON ERROR]", data.toString());
});

pythonProcess.on("close", (code) => {
    console.log(`⚠️ Python terminó con código ${code}`);
});
