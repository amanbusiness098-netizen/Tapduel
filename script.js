const copyRoomBtn = document.getElementById("copyRoomBtn");
const onlineCount = document.getElementById("onlineCount");
const totalMatches = document.getElementById("totalMatches");
const leaderboard = document.getElementById("leaderboard");
const playerStats = document.getElementById("playerStats");

const shareBtn = document.getElementById("shareBtn");

const youName = document.getElementById("youName");
const enemyName = document.getElementById("enemyName");

const statusText = document.getElementById("status");

const tapBtn = document.getElementById("tapBtn");

const startBtn = document.getElementById("startBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

const usernameInput = document.getElementById("username");
const roomInput = document.getElementById("roomInput");

const socket = io("https://tapduel.onrender.com", {
  autoConnect: false
});

const beepSound = new Audio("sounds/beep.mp3");
const startSound = new Audio("sounds/start.mp3");
const winSound = new Audio("sounds/win.mp3");
const loseSound = new Audio("sounds/lose.mp3");

let currentRoom = null;
let gameStarted = false;
let gameEnded = false;
let reactionStart;
let reactionInterval;
let waitingAnimation;
let username = "";
let mode = "quick";
let lastResultText = "";

const savedUsername =
  localStorage.getItem("tapduel_username");

if (savedUsername) {
  usernameInput.value = savedUsername;
}

tapBtn.style.display = "none";

function hideMenu() {

  usernameInput.disabled = true;
  usernameInput.style.display = "none";

  startBtn.style.display = "none";
  createRoomBtn.style.display = "none";
  joinRoomBtn.style.display = "none";
  roomInput.style.display = "none";

  tapBtn.style.display = "inline-block";

  leaderboard.style.display = "none";

  playerStats.style.display = "none";

  shareBtn.style.display = "none";
  copyRoomBtn.style.display = "none";
}

function showMenusAgain() {

  usernameInput.disabled = false;
  usernameInput.style.display = "block";

  startBtn.style.display = "block";
  createRoomBtn.style.display = "block";
  joinRoomBtn.style.display = "block";
  roomInput.style.display = "block";

  tapBtn.style.display = "none";

  playerStats.style.display = "block";
  leaderboard.style.display = "block";
}

function validateUsername() {

  username =
    usernameInput.value.trim();

  if (username.length < 2) {
    alert("Enter at least 2 letters");
    return false;
  }

  localStorage.setItem(
    "tapduel_username",
    username
  );

  return true;
}

startBtn.addEventListener("click", () => {

  if (!validateUsername()) return;

  mode = "quick";

  hideMenu();

  tapBtn.innerText = "CONNECTING...";
  tapBtn.disabled = true;

  socket.connect();
});

createRoomBtn.addEventListener("click", () => {

  if (!validateUsername()) return;

  mode = "create";

  hideMenu();

  tapBtn.innerText = "CREATING ROOM...";
  tapBtn.disabled = true;

  socket.connect();
});

joinRoomBtn.addEventListener("click", () => {

  if (!validateUsername()) return;

  const roomCode =
    roomInput.value.trim().toUpperCase();

  if (roomCode.length < 4) {
    alert("Invalid room code");
    return;
  }

  mode = "join";

  hideMenu();

  tapBtn.innerText = "JOINING ROOM...";
  tapBtn.disabled = true;

  socket.connect();

  socket.once("connect", () => {

    socket.emit("joinPrivateRoom", {
      username,
      roomCode
    });

  });

});

socket.on("connect", () => {

  if (mode === "quick") {
    socket.emit("joinGame", username);
  }

  if (mode === "create") {
    socket.emit("createPrivateRoom", username);
  }

});

socket.on("waiting", () => {

  tapBtn.innerText = "WAITING";
  tapBtn.disabled = true;

  let dots = 0;

  clearInterval(waitingAnimation);

  waitingAnimation = setInterval(() => {

    dots = (dots + 1) % 4;

    statusText.innerText =
      "Waiting" + ".".repeat(dots);

  }, 500);

});

socket.on("privateRoomCreated", (data) => {

  currentRoom = data.roomCode;

  statusText.innerText =
    "Room Code:\n" + data.roomCode;

  tapBtn.innerText = "WAITING FOR FRIEND";
  tapBtn.disabled = true;

  copyRoomBtn.style.display = "block";
});

socket.on("privateRoomError", (message) => {
  alert(message);
  location.reload();
});

socket.on("matchFound", (data) => {

  clearInterval(waitingAnimation);

  currentRoom = data.room;

  gameStarted = false;
  gameEnded = false;

  youName.innerText = username;
  enemyName.innerText = data.opponentName;

  statusText.innerText =
    "Match Found vs " + data.opponentName;

  tapBtn.innerText = "WAIT...";
  tapBtn.disabled = true;
});

socket.on("countdown", (num) => {

  beepSound.play();

  statusText.classList.add("countdown");

  statusText.innerText = num;

});

socket.on("startGame", () => {

  startSound.play();

  statusText.classList.remove("countdown");

  statusText.innerText = "GO!";

  setTimeout(() => {

    gameStarted = true;

    reactionStart = Date.now();

    reactionInterval = setInterval(() => {

      const current =
        Date.now() - reactionStart;

      tapBtn.innerText =
        current + " ms";

    }, 10);

    tapBtn.innerText = "TAP";

    tapBtn.disabled = false;

    tapBtn.classList.add("activeBtn");

    statusText.innerText = "TAP NOW!";

  }, 400);

});

tapBtn.addEventListener("click", () => {

  if (gameEnded) {
    location.reload();
    return;
  }

  if (!gameStarted) return;

  clearInterval(reactionInterval);

  const clientReaction =
    Date.now() - reactionStart;

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

    statusText.innerText =
      "YOU WIN!\n" +
      data.t1 + "ms vs " +
      data.t2 + "ms";

    statusText.classList.add("win");

  } else {

    loseSound.play();

    statusText.innerText =
      "YOU LOSE!\n" +
      data.t1 + "ms vs " +
      data.t2 + "ms";

    statusText.classList.add("lose");

  }

  lastResultText =
    statusText.innerText +
    "\nPlay TapDuel: https://tapduel.vercel.app";

  tapBtn.innerText = "PLAY AGAIN";
  tapBtn.disabled = false;

  shareBtn.style.display = "block";

  playerStats.style.display = "block";
  leaderboard.style.display = "block";

});

socket.on("opponentLeft", () => {

  gameEnded = true;
  gameStarted = false;

  tapBtn.classList.remove("activeBtn");

  statusText.innerText = "Opponent Left";

  tapBtn.innerText = "PLAY AGAIN";
  tapBtn.disabled = false;

});

shareBtn.addEventListener("click", async () => {

  if (navigator.share) {

    await navigator.share({
      title: "TapDuel Result",
      text: lastResultText,
      url: "https://tapduel.vercel.app"
    });

  } else {

    navigator.clipboard.writeText(
      lastResultText
    );

    alert("Result copied!");

  }

});

copyRoomBtn.addEventListener("click", () => {

  const inviteText =
    "Join my TapDuel room: " +
    currentRoom +
    "\nhttps://tapduel.vercel.app";

  navigator.clipboard.writeText(inviteText);

  alert("Room link copied!");

});

socket.on("onlinePlayers", (count) => {
  onlineCount.innerText =
    count + " online";
});

async function loadGlobalStats() {

  try {

    const res =
      await fetch(
        "https://tapduel.onrender.com/stats"
      );

    const data = await res.json();

    totalMatches.innerText =
      (data.totalMatches || 0) +
      " matches";

    onlineCount.innerText =
      (data.onlinePlayers || 0) +
      " online";

  } catch (error) {

    console.log("Stats load failed");

  }

}

loadGlobalStats();

if ("serviceWorker" in navigator) {

  window.addEventListener("load", () => {

    navigator.serviceWorker.register("/sw.js");

  });

}