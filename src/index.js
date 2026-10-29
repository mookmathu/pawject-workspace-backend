require("dotenv").config(); // must run before ./app loads — passport and the OAuth routes read env vars at require time
const http = require("http");
const app = require("./app");
const { initSocket } = require("./lib/socket");

// Wrapping express in a plain http.Server (instead of app.listen() directly)
// is what lets Socket.IO attach to the same port — it needs the raw server
// to intercept the WebSocket upgrade handshake, which app.listen() hides.
const server = http.createServer(app);
initSocket(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pawject API running on http://localhost:${PORT}`);
});
