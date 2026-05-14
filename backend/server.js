const admin = require("firebase-admin");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let waitingPlayer = null;

const rooms = {};
const players = {};
const privateRooms = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinGame", (username) => {
    players[socket.id] = {
      username: cleanName(username)
    };

    if (waitingPlayer && waitingPlayer.connected && waitingPlayer.id !== socket.id) {
      createMatch(waitingPlayer, socket, null, "quick");
      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit("waiting");
    }
  });

  socket.on("createPrivateRoom", (username) => {
    players[socket.id] = {
      username: cleanName(username)
    };

    const roomCode = generateRoomCode();

    privateRooms[roomCode] = {
      host: socket.id,
      players: [socket.id]
    };

    socket.join(roomCode);

    socket.emit("privateRoomCreated", {
      roomCode
    });

    console.log("Private room created:", roomCode);
  });

  socket.on("joinPrivateRoom", (data) => {
    const username = cleanName(data.username);
    const roomCode = data.roomCode;

    players[socket.id] = {
      username
    };

    const privateRoom = privateRooms[roomCode];

    if (!privateRoom) {
      socket.emit("privateRoomError", "Room not found");
      return;
    }

    if (privateRoom.players.length >= 2) {
      socket.emit("privateRoomError", "Room is full");
      return;
    }

    const hostId = privateRoom.host;
    const hostSocket = io.sockets.sockets.get(hostId);

    if (!hostSocket) {
      socket.emit("privateRoomError", "Host left the room");
      delete privateRooms[roomCode];
      return;
    }

    privateRoom.players.push(socket.id);
    socket.join(roomCode);

    createMatch(hostSocket, socket, roomCode, "private");

    delete privateRooms[roomCode];
  });

  socket.on("tap", async (data) => {
    const room = typeof data === "string" ? data : data.room;
    const clientReaction = data.clientReaction || null;

    const game = rooms[room];

    if (!game) return;
    if (game.gameOver) return;
    if (!game.players.includes(socket.id)) return;
    if (game.clicks[socket.id]) return;

    if (!game.gameStarted) {
      game.gameOver = true;

      const opponent = game.players.find(id => id !== socket.id);

      io.to(room).emit("result", {
        winner: opponent,
        cheater: socket.id,
        winnerName: players[opponent]?.username || "Player",
        t1: 0,
        t2: 0
      });

      cleanupRoom(room);
      return;
    }

    const reactionTime = Date.now() - game.startTime;

    game.clicks[socket.id] = {
      serverReaction: reactionTime,
      clientReaction
    };

    if (Object.keys(game.clicks).length === 2) {
      game.gameOver = true;

      const [p1, p2] = game.players;

      const t1 = game.clicks[p1].clientReaction || game.clicks[p1].serverReaction;
      const t2 = game.clicks[p2].clientReaction || game.clicks[p2].serverReaction;

      const winner = t1 <= t2 ? p1 : p2;
      const loser = winner === p1 ? p2 : p1;

      const winnerName = players[winner]?.username || "Player";
      const loserName = players[loser]?.username || "Player";

      const winnerReaction =
        game.clicks[winner].clientReaction || game.clicks[winner].serverReaction;

      const loserReaction =
        game.clicks[loser].clientReaction || game.clicks[loser].serverReaction;

      io.to(room).emit("result", {
        winner,
        t1,
        t2,
        winnerName
      });

      try {
        await db.collection("leaderboard").add({
          winnerName,
          loserName,
          winnerReaction,
          loserReaction,
          winnerServerReaction: game.clicks[winner].serverReaction,
          loserServerReaction: game.clicks[loser].serverReaction,
          matchType: game.matchType,
          room,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePlayerStats(winnerName, true, winnerReaction);
        await updatePlayerStats(loserName, false, loserReaction);

        await db.collection("analytics").doc("global").set({
          totalMatches: admin.firestore.FieldValue.increment(1),
          lastMatchAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log("Stats saved:", winnerName, "beat", loserName);
      } catch (error) {
        console.error("Failed to save stats:", error);
      }

      cleanupRoom(room);
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    for (const code in privateRooms) {
      const privateRoom = privateRooms[code];

      if (privateRoom.players.includes(socket.id)) {
        io.to(code).emit("opponentLeft");
        delete privateRooms[code];
      }
    }

    for (const room in rooms) {
      const game = rooms[room];

      if (game.players.includes(socket.id)) {
        const opponent = game.players.find(id => id !== socket.id);

        if (opponent) {
          io.to(opponent).emit("opponentLeft");
        }

        cleanupRoom(room);
      }
    }

    delete players[socket.id];
  });
});

function createMatch(player1, player2, customRoom = null, matchType = "quick") {
  const room = customRoom || player1.id + "#" + player2.id;

  player1.join(room);
  player2.join(room);

  rooms[room] = {
    startTime: null,
    gameStarted: false,
    gameOver: false,
    clicks: {},
    players: [player1.id, player2.id],
    countdownInterval: null,
    startTimeout: null,
    matchType
  };

  player1.emit("matchFound", {
    room,
    opponentName: players[player2.id]?.username || "Player"
  });

  player2.emit("matchFound", {
    room,
    opponentName: players[player1.id]?.username || "Player"
  });

  startCountdown(room);
}

function startCountdown(room) {
  let countdown = 3;

  rooms[room].countdownInterval = setInterval(() => {
    if (!rooms[room]) return;

    io.to(room).emit("countdown", countdown);
    countdown--;

    if (countdown < 0) {
      clearInterval(rooms[room].countdownInterval);

      rooms[room].startTimeout = setTimeout(() => {
        if (!rooms[room]) return;

        rooms[room].gameStarted = true;
        rooms[room].startTime = Date.now();

        io.to(room).emit("startGame");
      }, Math.random() * 2000 + 1000);
    }
  }, 1000);
}

async function updatePlayerStats(username, didWin, reaction) {
  const playerId = username.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const ref = db.collection("players").doc(playerId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);

    if (!doc.exists) {
      transaction.set(ref, {
        username,
        wins: didWin ? 1 : 0,
        losses: didWin ? 0 : 1,
        gamesPlayed: 1,
        fastestReaction: reaction,
        lastReaction: reaction,
        lastPlayed: admin.firestore.FieldValue.serverTimestamp()
      });

      return;
    }

    const data = doc.data();
    const currentFastest = data.fastestReaction || reaction;
    const newFastest = Math.min(currentFastest, reaction);

    transaction.update(ref, {
      username,
      wins: admin.firestore.FieldValue.increment(didWin ? 1 : 0),
      losses: admin.firestore.FieldValue.increment(didWin ? 0 : 1),
      gamesPlayed: admin.firestore.FieldValue.increment(1),
      fastestReaction: newFastest,
      lastReaction: reaction,
      lastPlayed: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

function cleanupRoom(room) {
  const game = rooms[room];

  if (!game) return;

  if (game.countdownInterval) {
    clearInterval(game.countdownInterval);
  }

  if (game.startTimeout) {
    clearTimeout(game.startTimeout);
  }

  delete rooms[room];

  console.log("Room cleaned:", room);
}

function generateRoomCode() {
  let code = "";

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  if (privateRooms[code]) {
    return generateRoomCode();
  }

  return code;
}

function cleanName(name) {
  if (!name) return "Player";

  return String(name)
    .trim()
    .slice(0, 12) || "Player";
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});