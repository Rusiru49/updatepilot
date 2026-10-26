import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "UpdatePilot API" });
});

app.listen(PORT, () => {
  console.log(`UpdatePilot API running on http://localhost:${PORT}`);
});