import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import clientesCcRouter from "./routes/clientesCc.js";

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

app.use("/api/clientes-cc", clientesCcRouter);

app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});

export default app;
