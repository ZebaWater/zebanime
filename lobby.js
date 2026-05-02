// lobby.js

import { db } from "./firebase-init.js";
import { getPlayer, generateRoomCode, saveName, generateName } from "./player.js";
import { pickRandomAnimeId } from "./anime-ids.js";
import { fetchEnrichedAnime } from "./jikan.js";
import { buildClueValues } from "./clues.js";
import {
  doc, setDoc, getDoc, updateDoc,
  onSnapshot, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const player = getPlayer();

const nameInput      = document.getElementById("name-input");
const rerollBtn      = document.getElementById("reroll-btn");
const createBtn      = document.getElementById("create-room-btn");
const joinBtn        = document.getElementById("join-room-btn");
const roomCodeInput  = document.getElementById("room-code-input");
const statusMsg      = document.getElementById("lobby-status");
const waitingOverlay = document.getElementById("waiting-overlay");
const waitingCodeEl  = document.getElementById("waiting-code");
const cancelRoomBtn  = document.getElementById("cancel-room-btn");

let unsubscribeRoom = null;
let currentRoomCode = null;

// ── Name ──
nameInput.value = player.name;

nameInput.addEventListener("change", () => {
  const val = nameInput.value.trim();
  if (val.length > 0) { player.name = val; saveName(val); }
});

rerollBtn.addEventListener("click", () => {
  const name = generateName();
  nameInput.value = name;
  player.name = name;
  saveName(name);
});

// ── CREATE ROOM ──
createBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (name) { player.name = name; saveName(name); }

  setStatus("Creating room…");
  createBtn.disabled = true;

  try {
    const code    = generateRoomCode();
    const animeId = pickRandomAnimeId();

    setStatus("Fetching anime data…");
    const animeData  = await fetchEnrichedAnime(animeId);
    const clueValues = buildClueValues(animeData);

    const roomRef = doc(db, "rooms", code);
    await setDoc(roomRef, {
      status:             "waiting",
      hostId:             player.uid,
      hostName:           player.name,
      guestId:            null,
      guestName:          null,
      animeId:            animeId,
      animeTitle:         animeData.title,
      animeTitleEnglish:  animeData.title_english  || "",
      animeTitleJapanese: animeData.title_japanese || "",
      animeTitles:        animeData.titles         || [],
      animeImage:         animeData.images?.jpg?.image_url || null,
      clueValues:         clueValues,
      round:              0,
      timerEndsAt:        null,
      revealedClueCount:  0,
      suddenDeath:        false,
      winner:             null,
      winnerName:         null,
      draw:               false,
      rematchReady:       { hostReady: false, guestReady: false },
      rematchVersion:     0,
      createdAt:          serverTimestamp(),
      deleteAt:           Date.now() + 30 * 60 * 1000
    });

    currentRoomCode = code;
    showWaitingOverlay(code);
    setStatus("");

    unsubscribeRoom = onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.guestId) {
        unsubscribeRoom?.();
        window.location.href = `game.html?room=${code}`;
      }
    });

  } catch (err) {
    console.error(err);
    setStatus("Error creating room. Try again.");
    createBtn.disabled = false;
  }
});

// ── JOIN ROOM ──
joinBtn.addEventListener("click", () => joinRoom());
roomCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });

async function joinRoom() {
  const name = nameInput.value.trim();
  if (name) { player.name = name; saveName(name); }

  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 6) { setStatus("Enter a valid 6-character room code."); return; }

  setStatus("Joining room…");
  joinBtn.disabled = true;

  try {
    const roomRef  = doc(db, "rooms", code);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) { setStatus("Room not found."); joinBtn.disabled = false; return; }

    const data = roomSnap.data();
    if (data.status !== "waiting") { setStatus("Room is already in progress or finished."); joinBtn.disabled = false; return; }
    if (data.hostId === player.uid) { setStatus("That's your own room."); joinBtn.disabled = false; return; }

    await updateDoc(roomRef, {
      guestId:   player.uid,
      guestName: player.name,
      status:    "in_progress"
    });

    window.location.href = `game.html?room=${code}`;

  } catch (err) {
    console.error(err);
    setStatus("Failed to join. Check the code and try again.");
    joinBtn.disabled = false;
  }
}

// ── CANCEL ──
cancelRoomBtn.addEventListener("click", async () => {
  unsubscribeRoom?.();
  if (currentRoomCode) {
    try { await deleteDoc(doc(db, "rooms", currentRoomCode)); } catch {}
  }
  waitingOverlay.classList.add("hidden");
  createBtn.disabled = false;
  setStatus("");
});

function showWaitingOverlay(code) {
  waitingCodeEl.textContent = code;
  waitingOverlay.classList.remove("hidden");
}

function setStatus(msg) { statusMsg.textContent = msg; }