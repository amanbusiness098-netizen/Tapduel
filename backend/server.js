const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

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

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    if (waitingPlayer) {

        const room = socket.id + "#" + waitingPlayer.id;
        socket.join(room);
        waitingPlayer.join(room);

        rooms[room] = {
            startTime: null,
            gameStarted: false,
            clicks: {},
            players: [socket.id, waitingPlayer.id]
        };

        socket.emit("matchFound", room);
        waitingPlayer.emit("matchFound", room);

        // random start
        let countdown = 3;

        const countdownInterval = setInterval(() => {

            io.to(room).emit("countdown", countdown);

            countdown--;

            if (countdown < 0) {

                clearInterval(countdownInterval);

                setTimeout(() => {

                    rooms[room].gameStarted = true;

                    rooms[room].startTime = Date.now();

                    io.to(room).emit("startGame");

                }, Math.random() * 2000 + 1000);

            }

        }, 1000);

        waitingPlayer = null;

    } else {

        waitingPlayer = socket;

        socket.emit("waiting");

    }

    // PLAYER TAP
    socket.on("tap", (room) => {

        const game = rooms[room];

        if (!game) return;

        // EARLY CLICK = LOSE
        if (!game.gameStarted) {

            const opponent = game.players.find(id => id !== socket.id);

            io.to(room).emit("result", {
                winner: opponent,
                cheater: socket.id
            });

            delete rooms[room];

            return;
        }

        // NORMAL REACTION
        const reactionTime = Date.now() - game.startTime;

        game.clicks[socket.id] = reactionTime;

        console.log(socket.id, reactionTime);

        // BOTH PLAYERS CLICKED
        if (Object.keys(game.clicks).length === 2) {

            const [p1, p2] = game.players;

            const t1 = game.clicks[p1];
            const t2 = game.clicks[p2];

            let winner;

            if (t1 < t2) {
                winner = p1;
            } else {
                winner = p2;
            }

            io.to(room).emit("result", {
                winner,
                t1,
                t2
            });

            delete rooms[room];
        }

    });

});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});