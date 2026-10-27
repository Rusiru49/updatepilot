import express from "express";
import cors from "cors";
import "dotenv/config";
import applicationsRouter from "./routes/applications";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "UpdatePilot API" });
});

app.use("/api/v1/applications", applicationsRouter);

// Unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Central error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
});

app.listen(PORT, () => {
  console.log(`UpdatePilot API running on http://localhost:${PORT}`);
});