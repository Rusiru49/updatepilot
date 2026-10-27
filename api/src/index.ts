import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import authRouter from "./routes/auth";
import applicationsRouter from "./routes/applications";

const app = express();
const PORT = process.env.PORT || 4000;

// Only the frontend may call the API with cookies
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Max 20 login/register attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again in 15 minutes." } },
});

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "UpdatePilot API" });
});

app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/register", authLimiter);
app.use("/api/v1/auth", authRouter);
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