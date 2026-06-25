const { io } = require("socket.io-client");

const socket = io("http://localhost:3000", {
  transports: ["websocket"],
  query: {
    transport: "socketio"
  }
});

socket.on("connect", () => {
  console.log("Connected as player 1");
  
  socket.emit("start_match", { matchId: "TEST_RUN" });

  setTimeout(() => {
    socket.emit("dev_spawn_bots", { count: 3 });
  }, 1000);
});

socket.onAny((ev, ...args) => {
  console.log("Got event:", ev, typeof args[0] === 'object' && Object.keys(args[0]).length);
});

socket.on("state_sync", (msg) => {
  if (msg.players && msg.players.length > 1) {
    console.log("GOT state_sync PLAYERS:", JSON.stringify(msg.players, null, 2));
    process.exit(0);
  }
});

setTimeout(() => {
  console.log("Timeout waiting for state_sync");
  process.exit(1);
}, 5000);
