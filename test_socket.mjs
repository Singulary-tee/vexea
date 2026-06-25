import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:3000");

socket.on("connect", () => {
  console.log("Connected");
  
  socket.emit("start_match", {
    uid: "test_uid",
    matchId: "M_TEST_123",
    mapId: "map_1_facility"
  });

  setTimeout(() => {
    socket.emit("debug_get_state", {});
  }, 1000);
});

socket.on("debug_state_response", (state) => {
  console.log("State:", state);
  process.exit(0);
});
