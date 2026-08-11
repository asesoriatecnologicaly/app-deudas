const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const clientesCcRouter = require("./routes/clientesCc.js");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS: permitir el frontend de Hostinger y localhost para desarrollo
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://palegreen-otter-518550.hostingersite.com",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Permitir requests sin origin (Postman, curl, health checks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("No permitido por CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "API de deudas de clientes" });
});

// TEMPORAL - diagnostico de migracion a Supabase.
// Comprueba desde el propio servidor de Hostinger si hay salida al puerto de
// PostgreSQL. No usa credenciales ni toca ninguna base. Borrar una vez
// confirmada la migracion.
app.get("/api/_diag/supabase", async (req, res) => {
  const net = require("net");
  const dns = require("dns").promises;
  const host = "aws-0-sa-east-1.pooler.supabase.com";
  const resultado = { host, dns: null, puerto5432: null, puerto6543: null };

  try {
    const r = await dns.lookup(host, { all: true });
    resultado.dns = r.map((x) => `${x.address} (IPv${x.family})`);
  } catch (e) {
    resultado.dns = `ERROR: ${e.code}`;
  }

  const probar = (puerto) =>
    new Promise((resolve) => {
      const inicio = Date.now();
      const s = net.createConnection({ host, port: puerto });
      s.setTimeout(8000);
      s.on("connect", () => { s.destroy(); resolve(`OK (${Date.now() - inicio} ms)`); });
      s.on("timeout", () => { s.destroy(); resolve("BLOQUEADO (timeout)"); });
      s.on("error", (e) => resolve(`BLOQUEADO (${e.code})`));
    });

  resultado.puerto5432 = await probar(5432);
  resultado.puerto6543 = await probar(6543);
  resultado.veredicto = resultado.puerto5432.startsWith("OK")
    ? "Hostinger PUEDE conectarse a Supabase. Se puede migrar."
    : "Hostinger NO puede salir al 5432. NO migrar todavia.";

  res.json(resultado);
});

app.use("/api/clientes-cc", clientesCcRouter);

app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});

module.exports = app;
