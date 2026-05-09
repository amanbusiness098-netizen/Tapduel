const socket = io("http://localhost:3000");

const statusText = document.getElementById("status");
const tapBtn = document.getElementById("tapBtn");

let currentRoom = null;
let gameStarted = false;
let gameEnded = false;

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("waiting", () => {

  statusText.innerText = "Waiting for opponent...";

  tapBtn.innerText = "WAITING";
  tapBtn.disabled = true;

});

socket.on("matchFound", (room) => {

  currentRoom = room;

  gameStarted = false;
  gameEnded = false;

  statusText.innerText = "Match Found!";

  tapBtn.innerText = "WAIT...";
  tapBtn.disabled = true;

});

socket.on("countdown", (num) => {

  statusText.innerText = num;

  statusText.classList.add("countdown");

});

socket.on("startGame", () => {

  statusText.classList.remove("countdown");

  gameStarted = true;

  statusText.innerText = "TAP NOW!";

  tapBtn.innerText = "TAP";
  tapBtn.disabled = false;

  tapBtn.classList.add("activeBtn");

});

tapBtn.addEventListener("click", () => {

  if (!gameStarted || gameEnded) return;

  socket.emit("tap", currentRoom);

  tapBtn.disabled = true;

});

socket.on("result", (data) => {

  gameEnded = true;

  tapBtn.classList.remove("activeBtn");

  statusText.classList.remove("win");
  statusText.classList.remove("lose");

  if (data.winner === socket.id) {

    statusText.innerText = "YOU WIN!";
    statusText.classList.add("win");

  } else {

    statusText.innerText = "YOU LOSE!";
    statusText.classList.add("lose");

  }

  tapBtn.innerText = "REFRESH";
  tapBtn.disabled = false;

});

tapBtn.addEventListener("click", () => {

  if (gameEnded) {

    location.reload();

  }

});