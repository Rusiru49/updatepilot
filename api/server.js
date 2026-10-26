const http = require("http");
const PORT = 4000;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/v1/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "UpdatePilot API" }));
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => console.log(`UpdatePilot API running on http://localhost:${PORT}`));