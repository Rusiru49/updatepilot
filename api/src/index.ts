import "dotenv/config";
import app from "./app";
import { AGENT_LOST_MS, failJobsOfLostAgents } from "./lib/recovery";

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`UpdatePilot API running on http://localhost:${PORT}`);
});

// Every 30 s, close jobs whose agent has disappeared.
// Wait one full window after startup first: while the API was down, no agent could send
// heartbeats, so they would all look "lost" for a moment.
setTimeout(() => {
  setInterval(() => {
    failJobsOfLostAgents()
      .then((n) => { if (n) console.log(`Closed jobs on ${n} unresponsive device(s)`); })
      .catch((err) => console.error("Recovery check failed:", err));
  }, 30_000);
}, AGENT_LOST_MS);