"use strict";

const https = require("https");
const crypto = require("crypto");

const settings = {
  guessesPerSecond: 1e10,
  weakThreshold: 34,
  mediumThreshold: 67,
  minimumRecommendedLength: 12
};

const commonPatterns = [
  "password",
  "admin",
  "welcome",
  "qwerty",
  "letmein",
  "monkey",
  "dragon",
  "abc123",
  "iloveyou",
  "123456",
  "111111",
  "000000"
];

const breachCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function log2(value) {
  return Math.log(value) / Math.log(2);
}

function humanizeDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Instantly";
  }

  const compactFormatter = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  const units = [
    { label: "centuries", seconds: 60 * 60 * 24 * 365 * 100 },
    { label: "years", seconds: 60 * 60 * 24 * 365 },
    { label: "months", seconds: 60 * 60 * 24 * 30 },
    { label: "days", seconds: 60 * 60 * 24 },
    { label: "hours", seconds: 60 * 60 },
    { label: "minutes", seconds: 60 },
    { label: "seconds", seconds: 1 }
  ];

  for (const unit of units) {
    if (seconds >= unit.seconds) {
      const value = seconds / unit.seconds;
      if (value >= 1000 && unit.label !== "centuries") {
        continue;
      }

      const formattedValue =
        value >= 1000 ? compactFormatter.format(value) : value.toFixed(value >= 10 ? 0 : 1);
      return `${formattedValue} ${unit.label}`;
    }
  }

  return "Under a second";
}

function classifyScore(score) {
  if (score < settings.weakThreshold) {
    return "weak";
  }

  if (score < settings.mediumThreshold) {
    return "medium";
  }

  return "strong";
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "Add-Padding": "true",
          "User-Agent": "password-strength-checker"
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Unexpected breach API status: ${res.statusCode}`));
          return;
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      }
    );

    req.setTimeout(4000, () => {
      req.destroy(new Error("Breach API timeout"));
    });

    req.on("error", reject);
  });
}

async function checkPasswordBreach(password) {
  if (!password) {
    return {
      status: "not_checked",
      found: false,
      count: 0,
      message: "Enter a password to check whether it appears in known breaches."
    };
  }

  const sha1 = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const responseText = breachCache.has(prefix)
      ? breachCache.get(prefix)
      : await fetchText(`https://api.pwnedpasswords.com/range/${prefix}`);

    breachCache.set(prefix, responseText);

    const match = responseText
      .split("\r\n")
      .find((line) => line.startsWith(`${suffix}:`));

    if (!match) {
      return {
        status: "not_found",
        found: false,
        count: 0,
        message: "This password was not found in the breach dataset checked."
      };
    }

    const [, countText = "0"] = match.split(":");
    const count = Number.parseInt(countText, 10) || 0;
    return {
      status: "compromised",
      found: true,
      count,
      message: `This password has appeared in ${count.toLocaleString("en-US")} breach records.`
    };
  } catch (_error) {
    return {
      status: "unavailable",
      found: null,
      count: null,
      message: "Breach status is unavailable right now."
    };
  }
}

async function analyzePassword(password) {
  const value = String(password || "");
  const trimmed = value.trim();
  const length = value.length;
  const uniqueChars = new Set(value).size;

  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);

  let charsetSize = 0;
  if (hasLower) charsetSize += 26;
  if (hasUpper) charsetSize += 26;
  if (hasDigit) charsetSize += 10;
  if (hasSymbol) charsetSize += 33;

  const repeatedPatternMatches = value.match(/(.)\1{2,}/g) || [];
  const sequenceMatches = value.match(
    /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|123|234|345|456|567|678|789)/gi
  ) || [];
  const commonPatternHit = commonPatterns.find((pattern) =>
    value.toLowerCase().includes(pattern)
  );

  const baseEntropy = length > 0 && charsetSize > 0 ? length * log2(charsetSize) : 0;
  const uniquenessRatio = length > 0 ? uniqueChars / length : 0;
  const uniquenessBonus = uniquenessRatio * 12;
  const lengthBonus = clamp((length - 8) * 2.5, 0, 20);
  const varietyBonus = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length * 6;

  let penalties = 0;
  if (trimmed.length !== value.length) penalties += 5;
  if (length < settings.minimumRecommendedLength) penalties += (settings.minimumRecommendedLength - length) * 2.4;
  if (repeatedPatternMatches.length) penalties += repeatedPatternMatches.length * 8;
  if (sequenceMatches.length) penalties += sequenceMatches.length * 7;
  if (commonPatternHit) penalties += 22;
  if (uniquenessRatio < 0.55) penalties += 12;

  const effectiveEntropy = Math.max(baseEntropy - penalties, 0);
  const normalizedEntropyScore = clamp((effectiveEntropy / 90) * 100, 0, 100);
  const score = Math.round(
    clamp(normalizedEntropyScore * 0.7 + lengthBonus + varietyBonus + uniquenessBonus - penalties * 0.35, 0, 100)
  );
  const strength = classifyScore(score);
  const crackTimeSeconds = Math.pow(2, effectiveEntropy) / settings.guessesPerSecond;

  const feedback = [];
  if (length < settings.minimumRecommendedLength) {
    feedback.push(`Use at least ${settings.minimumRecommendedLength} characters.`);
  }
  if (!hasUpper) feedback.push("Add uppercase letters.");
  if (!hasLower) feedback.push("Add lowercase letters.");
  if (!hasDigit) feedback.push("Add numbers.");
  if (!hasSymbol) feedback.push("Add symbols.");
  if (repeatedPatternMatches.length) feedback.push("Avoid repeated character runs.");
  if (sequenceMatches.length) feedback.push("Avoid keyboard or numeric sequences.");
  if (commonPatternHit) feedback.push("Remove common words or leaked-password patterns.");

  if (feedback.length === 0) {
    feedback.push("Balanced password. Consider a passphrase for even more resilience.");
  }

  const breach = await checkPasswordBreach(value);
  if (breach.status === "compromised") {
    feedback.unshift("Do not reuse this password. It appears in breach datasets.");
  } else if (breach.status === "unavailable") {
    feedback.push("Could not verify breach history at the moment.");
  }

  return {
    passwordLength: length,
    score,
    strength,
    entropyBits: Number(effectiveEntropy.toFixed(1)),
    crackTimeSeconds,
    crackTimeDisplay: humanizeDuration(crackTimeSeconds),
    checks: {
      hasLower,
      hasUpper,
      hasDigit,
      hasSymbol,
      uniqueChars,
      repeatedPatternCount: repeatedPatternMatches.length,
      sequenceCount: sequenceMatches.length,
      commonPatternHit: commonPatternHit || null
    },
    breach,
    feedback
  };
}

module.exports = {
  analyzePassword
};
