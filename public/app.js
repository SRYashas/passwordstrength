const passwordInput = document.getElementById("passwordInput");
const togglePasswordButton = document.getElementById("togglePassword");
const strengthLabel = document.getElementById("strengthLabel");
const meterFill = document.getElementById("meterFill");
const scoreLabel = document.getElementById("scoreLabel");
const entropyLabel = document.getElementById("entropyLabel");
const crackTimeLabel = document.getElementById("crackTimeLabel");
const coverageList = document.getElementById("coverageList");
const feedbackList = document.getElementById("feedbackList");
const breachStatusLabel = document.getElementById("breachStatusLabel");
const breachMessage = document.getElementById("breachMessage");
const numberRain = document.getElementById("numberRain");
const backgroundFx = document.getElementById("backgroundFx");

let analyzeTimeout;
let mineSpawner = null;
let laserCannon = null;
let currentStrengthState = "idle";

const strengthColors = {
  weak: "#ff5d6c",
  medium: "#ffb84d",
  strong: "#40d98f"
};

const rainThemes = {
  idle: {
    color: "rgba(255, 214, 102, 0.42)",
    glow: "rgba(255, 196, 64, 0.34)",
    highlight: "rgba(255, 232, 163, 0.28)"
  },
  weak: {
    color: "rgba(255, 112, 124, 0.46)",
    glow: "rgba(255, 193, 79, 0.38)",
    highlight: "rgba(255, 220, 128, 0.3)"
  },
  medium: {
    color: "rgba(255, 197, 94, 0.48)",
    glow: "rgba(255, 210, 98, 0.42)",
    highlight: "rgba(255, 232, 163, 0.34)"
  },
  strong: {
    color: "rgba(108, 231, 165, 0.44)",
    glow: "rgba(255, 201, 82, 0.36)",
    highlight: "rgba(255, 228, 143, 0.3)"
  }
};

const breachStyles = {
  not_checked: { label: "Not checked", color: "#9da9bb" },
  not_found: { label: "Not found in breaches", color: "#40d98f" },
  compromised: { label: "Previously exposed", color: "#ff5d6c" },
  unavailable: { label: "Check unavailable", color: "#ffb84d" }
};

function applyRainTheme(state) {
  if (!numberRain) {
    return;
  }

  const theme = rainThemes[state] || rainThemes.idle;
  numberRain.style.setProperty("--rain-color", theme.color);
  numberRain.style.setProperty("--rain-glow", theme.glow);
  numberRain.style.setProperty("--rain-highlight", theme.highlight);
}

function buildNumberRain() {
  if (!numberRain) {
    return;
  }

  const width = window.innerWidth;
  const count = width < 640 ? 18 : width < 980 ? 26 : 34;
  numberRain.innerHTML = "";

  for (let index = 0; index < count; index += 1) {
    const digit = document.createElement("span");
    digit.className = "rain-digit";
    digit.textContent = String(Math.floor(Math.random() * 10));
    digit.style.left = `${(index / count) * 100}%`;
    digit.style.animationDelay = `${Math.random() * -18}s`;
    digit.style.animationDuration = `${12 + Math.random() * 12}s`;
    digit.style.opacity = (0.42 + Math.random() * 0.18).toFixed(2);
    digit.style.fontSize = `${1 + Math.random() * 1.9}rem`;
    digit.style.setProperty("--drift", `${-20 + Math.random() * 40}px`);
    numberRain.appendChild(digit);
  }
}

function activeMines() {
  return backgroundFx ? [...backgroundFx.querySelectorAll(".spike-mine:not(.is-destroyed)")] : [];
}

function createMine() {
  if (!backgroundFx || activeMines().length >= 12) {
    return;
  }

  const mine = document.createElement("div");
  mine.className = "spike-mine";
  mine.style.left = `${6 + Math.random() * 88}%`;
  mine.style.top = `${-14 - Math.random() * 18}vh`;
  mine.style.width = `${30 + Math.random() * 26}px`;
  mine.style.height = mine.style.width;
  mine.style.animationDuration = `${8 + Math.random() * 6}s`;
  mine.style.animationDelay = `${Math.random() * -2}s`;

  const core = document.createElement("div");
  core.className = "mine-core";
  mine.appendChild(core);

  for (let index = 0; index < 8; index += 1) {
    const spike = document.createElement("span");
    spike.className = "mine-spike";
    spike.style.setProperty("--rotation", `${index * 45}deg`);
    mine.appendChild(spike);
  }

  mine.addEventListener("animationend", () => {
    mine.remove();
  });

  backgroundFx.appendChild(mine);
}

function startMineSpawner() {
  if (mineSpawner) {
    return;
  }

  createMine();
  mineSpawner = window.setInterval(createMine, 650);
}

function stopMineSpawner() {
  if (!mineSpawner) {
    return;
  }

  window.clearInterval(mineSpawner);
  mineSpawner = null;
}

function clearMines() {
  if (!backgroundFx) {
    return;
  }

  backgroundFx.querySelectorAll(".spike-mine, .laser-beam, .laser-burst").forEach((node) => node.remove());
}

function fireLaserAtMine() {
  if (!backgroundFx) {
    return;
  }

  const mines = activeMines();
  if (mines.length === 0) {
    return;
  }

  const mine = mines[Math.floor(Math.random() * mines.length)];
  const fxRect = backgroundFx.getBoundingClientRect();
  const mineRect = mine.getBoundingClientRect();
  const startX = fxRect.width * 0.5;
  const startY = fxRect.height * 0.08;
  const endX = mineRect.left - fxRect.left + mineRect.width / 2;
  const endY = mineRect.top - fxRect.top + mineRect.height / 2;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);
  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

  const beam = document.createElement("div");
  beam.className = "laser-beam";
  beam.style.left = `${startX}px`;
  beam.style.top = `${startY}px`;
  beam.style.width = `${length}px`;
  beam.style.transform = `rotate(${angle}deg)`;
  backgroundFx.appendChild(beam);

  const burst = document.createElement("div");
  burst.className = "laser-burst";
  burst.style.left = `${endX}px`;
  burst.style.top = `${endY}px`;
  backgroundFx.appendChild(burst);

  mine.classList.add("is-destroyed");
  window.setTimeout(() => beam.remove(), 180);
  window.setTimeout(() => burst.remove(), 260);
  window.setTimeout(() => mine.remove(), 180);
}

function startLaserCannon() {
  if (laserCannon) {
    return;
  }

  laserCannon = window.setInterval(() => {
    if (activeMines().length === 0) {
      createMine();
    }
    fireLaserAtMine();
  }, 220);
}

function stopLaserCannon() {
  if (!laserCannon) {
    return;
  }

  window.clearInterval(laserCannon);
  laserCannon = null;
  if (backgroundFx) {
    backgroundFx.querySelectorAll(".laser-beam, .laser-burst").forEach((node) => node.remove());
  }
}

function syncBattleState(strength) {
  const state = strength || "idle";
  currentStrengthState = state;

  if (state === "weak") {
    stopLaserCannon();
    startMineSpawner();
    return;
  }

  if (state === "strong") {
    stopMineSpawner();
    startLaserCannon();
    return;
  }

  stopMineSpawner();
  stopLaserCannon();

  if (state === "idle") {
    clearMines();
  }
}

function renderCoverage(checks = {}) {
  const items = [
    { label: "Lowercase", active: checks.hasLower },
    { label: "Uppercase", active: checks.hasUpper },
    { label: "Digits", active: checks.hasDigit },
    { label: "Symbols", active: checks.hasSymbol }
  ];

  coverageList.innerHTML = items
    .map(
      (item) =>
        `<span class="chip ${item.active ? "active" : ""}">${item.label}</span>`
    )
    .join("");
}

function renderFeedback(entries = []) {
  feedbackList.innerHTML = entries.map((entry) => `<li>${entry}</li>`).join("");
}

function renderBreachStatus(breach = {}) {
  const style = breachStyles[breach.status] || breachStyles.unavailable;
  breachStatusLabel.textContent = style.label;
  breachStatusLabel.style.color = style.color;
  breachMessage.textContent = breach.message || "Breach status is unavailable right now.";
}

function renderAnalysis(result) {
  const color = strengthColors[result.strength] || "#5fd3ff";
  strengthLabel.textContent = result.strength
    ? result.strength.charAt(0).toUpperCase() + result.strength.slice(1)
    : "Waiting for input";
  strengthLabel.style.color = color;
  meterFill.style.width = `${result.score}%`;
  meterFill.style.boxShadow = `0 0 24px ${color}`;
  scoreLabel.textContent = `Score: ${result.score} / 100`;
  entropyLabel.textContent = `Entropy: ${result.entropyBits} bits`;
  crackTimeLabel.textContent = result.crackTimeDisplay;
  crackTimeLabel.style.color = color;
  applyRainTheme(result.strength || "idle");
  syncBattleState(result.strength || "idle");
  renderCoverage(result.checks);
  renderBreachStatus(result.breach);
  renderFeedback(result.feedback);
}

function renderEmptyState() {
  renderAnalysis({
    score: 0,
    strength: "",
    entropyBits: 0,
    crackTimeDisplay: "Instantly",
    checks: {},
    breach: {
      status: "not_checked",
      message: "Enter a password to check whether it appears in known breaches."
    },
    feedback: ["Start typing to see strength analysis, crack-time estimation, and breach status."]
  });
  strengthLabel.textContent = "Waiting for input";
  strengthLabel.style.color = "#f5f7fb";
  applyRainTheme("idle");
  syncBattleState("idle");
}

async function analyzePassword(password) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    throw new Error("Analysis failed");
  }

  return response.json();
}

passwordInput.addEventListener("input", () => {
  clearTimeout(analyzeTimeout);
  const value = passwordInput.value;

  if (!value) {
    renderEmptyState();
    return;
  }

  analyzeTimeout = setTimeout(async () => {
    try {
      const result = await analyzePassword(value);
      renderAnalysis(result);
    } catch (error) {
      applyRainTheme("idle");
      syncBattleState("idle");
      renderBreachStatus({
        status: "unavailable",
        message: "The password could not be analyzed right now."
      });
      renderFeedback(["Unable to analyze the password right now."]);
    }
  }, 120);
});

togglePasswordButton.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePasswordButton.textContent = isPassword ? "Hide" : "Show";
});

window.addEventListener("resize", () => {
  buildNumberRain();
  if (currentStrengthState === "strong" && activeMines().length === 0) {
    createMine();
  }
});

buildNumberRain();
renderEmptyState();