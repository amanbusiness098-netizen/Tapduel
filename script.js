const leaderboardList = document.getElementById("leaderboardList");
let reactionInterval;
let reactionStart;
const socket = io("https://tapduel.onrender.com", {
  autoConnect: false
});


const youName = document.getElementById("youName");
const enemyName = document.getElementById("enemyName");
const statusText = document.getElementById("status");
const tapBtn = document.getElementById("tapBtn");
const startBtn = document.getElementById("startBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const usernameInput = document.getElementById("username");
const roomInput = document.getElementById("roomInput");

const beepSound = new Audio("sounds/beep.mp3");
const startSound = new Audio("sounds/start.mp3");
const winSound = new Audio("sounds/win.mp3");
const loseSound = new Audio("sounds/lose.mp3");

let currentRoom = null;
let gameStarted = false;
let gameEnded = false;
let username = "";
let mode = "quick";

tapBtn.style.display = "none";

function hideMenu() {
  usernameInput.disabled = true;
  usernameInput.style.display = "none";

  startBtn.style.display = "none";
  createRoomBtn.style.display = "none";
  joinRoomBtn.style.display = "none";
  roomInput.style.display = "none";

  tapBtn.style.display = "inline-block";
  tapBtn.disabled = true;
}

function validateUsername() {
  username = usernameInput.value.trim();

  if (username.length < 2) {
    alert("Enter at least 2 letters");
    return false;
  }

  return true;
}

startBtn.addEventListener("click", () => {
  if (!validateUsername()) return;

  mode = "quick";

  hideMenu();

  tapBtn.innerText = "CONNECTING...";

  socket.connect();
});

createRoomBtn.addEventListener("click", () => {
  if (!validateUsername()) return;

  mode = "create";

  hideMenu();

  tapBtn.innerText = "CREATING ROOM...";

  socket.connect();
});

joinRoomBtn.addEventListener("click", () => {
  if (!validateUsername()) return;

  const roomCode = roomInput.value.trim().toUpperCase();

  if (roomCode.length < 4) {
    alert("Invalid room code");
    return;
  }

  mode = "join";

  hideMenu();

  tapBtn.innerText = "JOINING ROOM...";

  socket.connect();

  socket.once("connect", () => {
    socket.emit("joinPrivateRoom", {
      username,
      roomCode
    });
  });
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  if (mode === "quick") {
    socket.emit("joinGame", username);
  }

  if (mode === "create") {
    socket.emit("createPrivateRoom", username);
  }
});

socket.on("waiting", () => {
  statusText.innerText = "Waiting for opponent...";
  tapBtn.innerText = "WAITING";
  tapBtn.disabled = true;
});

socket.on("privateRoomCreated", (data) => {
  currentRoom = data.roomCode;

  statusText.innerText = "Room Code:\n" + data.roomCode;
  tapBtn.innerText = "WAITING FOR FRIEND";
  tapBtn.disabled = true;
});

socket.on("privateRoomError", (message) => {
  alert(message);
  location.reload();
});

socket.on("matchFound", (data) => {
  currentRoom = data.room;
  gameStarted = false;
  gameEnded = false;
  youName.innerText = username;
  enemyName.innerText = data.opponentName;

  statusText.innerText = "Match Found vs " + data.opponentName;

  tapBtn.innerText = "WAIT...";
  tapBtn.disabled = true;
});

socket.on("countdown", (num) => {
  beepSound.play();

  statusText.innerText = num;
  statusText.classList.add("countdown");
});

socket.on("startGame", () => {
  startSound.play();

  statusText.classList.remove("countdown");

  statusText.innerText = "GO!";
  statusText.style.color = "#00ff99";
  statusText.style.transform = "scale(1.5)";

  setTimeout(() => {
    gameStarted = true;
    reactionStart = Date.now();

    reactionInterval = setInterval(() => {

      const current = Date.now() - reactionStart;

      tapBtn.innerText = current + " ms";

    }, 10);

    if (navigator.vibrate) {
      navigator.vibrate(120);
    }

    statusText.innerText = "TAP NOW!";
    statusText.style.transform = "scale(1)";

    tapBtn.innerText = "TAP";
    tapBtn.disabled = false;
    tapBtn.classList.add("activeBtn");
  }, 400);
});

tapBtn.addEventListener("click", () => {
  if (gameEnded) {
    location.reload();
    return;
  }

  if (!gameStarted) return;
  clearInterval(reactionInterval);
  const clientReaction = Date.now() - reactionStart;

  socket.emit("tap", {
    room: currentRoom,
    clientReaction
  });
  tapBtn.disabled = true;
});

socket.on("result", (data) => {
  clearInterval(reactionInterval);
  gameEnded = true;
  gameStarted = false;

  tapBtn.classList.remove("activeBtn");

  statusText.classList.remove("win");
  statusText.classList.remove("lose");

  if (data.winner === socket.id) {
    winSound.play();

    if (navigator.vibrate) {
      navigator.vibrate([120, 50, 120]);
    }

    statusText.innerText =
      "YOU WIN!\n" +
      data.t1 + "ms vs " + data.t2 + "ms";

    statusText.classList.add("win");
  } else {
    loseSound.play();

    if (navigator.vibrate) {
      navigator.vibrate(300);
    }

    statusText.innerText =
      "YOU LOSE!\n" +
      data.t1 + "ms vs " + data.t2 + "ms";

    statusText.classList.add("lose");
  }

  tapBtn.innerText = "REFRESH";
  tapBtn.disabled = false;
});

socket.on("opponentLeft", () => {
  gameEnded = true;
  gameStarted = false;

  statusText.classList.remove("countdown");
  statusText.classList.remove("win");
  statusText.classList.add("lose");

  statusText.innerText = "Opponent Left";

  tapBtn.classList.remove("activeBtn");
  tapBtn.innerText = "REFRESH";
  tapBtn.disabled = false;
});