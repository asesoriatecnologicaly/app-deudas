import axios from "axios";

// Base de la API: Hostinger en produccion, localhost en desarrollo
const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:4000";

export const API = axios.create({
  baseURL: `${API_BASE}/api`,
});

export default API;
