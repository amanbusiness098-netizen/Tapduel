const dailyRewardBox = document.getElementById("dailyRewardBox");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const onlineCount = document.getElementById("onlineCount");
const totalMatches = document.getElementById("totalMatches");
const leaderboard = document.getElementById("leaderboard");
const playerStats = document.getElementById("playerStats");
let leaderboardRefreshTimeout;
const leaderboardList = document.getElementById("leaderboardList");
let reactionInterval;
let reactionStart;
let waitingAnimation;
const socket = io("https://tapduel.onrender.com", {
  autoConnect: false
});


const shareBtn = document.getElementById("shareBtn");
let lastResultText = "";
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
const savedUsername = localStorage.getItem("tapduel_username");

if (savedUsername) {
  usernameInput.value = savedUsername;
}
let mode = "quick";

tapBtn.style.display = "none";

function hideMenu() {
  dailyRewardBox.style.display = "none";
  usernameInput.disabled = true;
  usernameInput.style.display = "none";

  startBtn.style.display = "none";
  createRoomBtn.style.display = "none";
  joinRoomBtn.style.display = "none";
  roomInput.style.display = "none";

  tapBtn.style.display = "inline-block";
  tapBtn.disabled = true;
  leaderboard.style.display = "none";

  if (playerStats) {
    playerStats.style.display = "none";
  }
}

function validateUsername() {
  username = usernameInput.value.trim();
  localStorage.setItem("tapduel_username", username);

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

  statusText.innerText = "Room Code:\n" + data.roomCode;
  tapBtn.innerText = "WAITING FOR FRIEND";
  tapBtn.disabled = true;
  copyRoomBtn.style.display = "inline-block";
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
      "YOU WIN!\n" + data.t1 + "ms vs " + data.t2 + "ms";

    statusText.classList.add("win");
  } else {
    loseSound.play();

    if (navigator.vibrate) {
      navigator.vibrate(300);
    }

    statusText.innerText =
      "YOU LOSE!\n" + data.t1 + "ms vs " + data.t2 + "ms";

    statusText.classList.add("lose");
  }

  lastResultText =
    statusText.innerText + "\nPlay TapDuel: https://tapduel.vercel.app";

  shareBtn.style.display = "inline-block";

  tapBtn.innerText = "PLAY AGAIN";
  tapBtn.disabled = false;

  leaderboard.style.display = "block";

  if (playerStats) {
    playerStats.style.display = "block";
  }
  if (dailyRewardBox) {
    dailyRewardBox.style.display = "block";
  }
});

socket.on("opponentLeft", () => {
  gameEnded = true;
  gameStarted = false;

  statusText.classList.remove("countdown");
  statusText.classList.remove("win");
  statusText.classList.add("lose");

  statusText.innerText = "Opponent Left";

  tapBtn.classList.remove("activeBtn");
  tapBtn.innerText = "PLAY AGAIN";
  tapBtn.disabled = false;
});
shareBtn.addEventListener("click", async () => {
  if (navigator.share) {
    await navigator.share({
      title: "TapDuel Result",
      text: lastResultText,
      url: "https://tapduel.netlify.app"
    });
  } else {
    navigator.clipboard.writeText(lastResultText);
    alert("Result copied!");
  }
});

socket.on("onlinePlayers", (count) => {
  onlineCount.innerText = count + " online";
});

async function loadGlobalStats() {
  try {
    const res = await fetch("https://tapduel.onrender.com/stats");
    const data = await res.json();

    totalMatches.innerText = (data.totalMatches || 0) + " matches";

    if (data.onlinePlayers !== undefined) {
      onlineCount.innerText = data.onlinePlayers + " online";
    }
  } catch (error) {
    console.log("Stats load failed");
  }
}

loadGlobalStats();
copyRoomBtn.addEventListener("click", () => {
  const inviteText =
    "Join my TapDuel room: " +
    currentRoom +
    "\nhttps://tapduel.netlify.app";

  navigator.clipboard.writeText(inviteText);
  alert("Room link copied!");
});


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
const claimRewardBtn = document.getElementById("claimRewardBtn");
const streakCount = document.getElementById("streakCount");

let streak = localStorage.getItem("dailyStreak") || 0;
streakCount.innerText = streak + " Days";

claimRewardBtn.addEventListener("click", () => {
  alert("Daily reward is added automatically after your first match each day.");
});

const streakCount = document.getElementById("streakCount");

let streak = localStorage.getItem("dailyStreak") || 0;
streakCount.innerText = streak + " Days";

claimRewardBtn.addEventListener("click", () => {

  let lastClaim = localStorage.getItem("lastClaimDate");
  let today = new Date().toDateString();

  if (lastClaim === today) {
    alert("Daily reward already claimed today!");
    return;
  }

  streak++;
  localStorage.setItem("dailyStreak", streak);
  localStorage.setItem("lastClaimDate", today);

  streakCount.innerText = streak + " Days";


  alert("Reward claimed! +50 XP");
});