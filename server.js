"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { analyzePassword } = require("./lib/password-analyzer");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 8 * 1024;
const MAX_PASSWORD_LENGTH = 256;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const STATIC_ASSET_CACHE_SECONDS = 60 * 60;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const rateLimitStore = new Map();

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function cleanupRateLimitStore(now) {
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

function checkRateLimit(req) {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const ip = getClientIp(req);
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
    retryAfterSeconds: 0
  };
}

function buildSecurityHeaders(isStaticAsset = false) {
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self' https://api.pwnedpasswords.com"
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cache-Control": isStaticAsset
      ? `public, max-age=${STATIC_ASSET_CACHE_SECONDS}, immutable`
      : "no-store"
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildSecurityHeaders(false)
  });
  res.end(JSON.stringify(payload));
}

function validatePasswordInput(password) {
  if (typeof password !== "string") {
    throw new Error("Password must be a string.");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
  }

  return password;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        reject(new Error("Invalid JSON payload"));
      }
    });

    req.on("error", reject);
  });
}

function serveStaticFile(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const requestedFile = path.normalize(path.join(PUBLIC_DIR, safePath));
  const extension = path.extname(requestedFile);

  if (!requestedFile.startsWith(PUBLIC_DIR) || !mimeTypes[extension]) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(requestedFile, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      sendJson(res, 500, { error: "Failed to load asset" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[extension],
      ...buildSecurityHeaders(true)
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const requestUrl = new URL(req.url, `http://${host}`);
  const { pathname } = requestUrl;

  res.setTimeout(10 * 1000, () => {
    if (!res.headersSent) {
      sendJson(res, 408, { error: "Request timed out" });
    }
  });

  if (req.method === "POST" && pathname === "/api/analyze") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      sendJson(res, 415, { error: "Content-Type must be application/json." });
      return;
    }

    const rateLimit = checkRateLimit(req);
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);

    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", rateLimit.retryAfterSeconds);
      sendJson(res, 429, { error: "Too many requests. Please retry later." });
      return;
    }

    try {
      const { password = "" } = await readJsonBody(req);
      const result = await analyzePassword(validatePasswordInput(password));
      sendJson(res, 200, result);
    } catch (error) {
      const statusCode = error.message === "Payload too large" ? 413 : 400;
      sendJson(res, statusCode, { error: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    serveStaticFile(res, pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.headersTimeout = 10 * 1000;
server.requestTimeout = 10 * 1000;
server.keepAliveTimeout = 5 * 1000;

server.listen(PORT, () => {
  console.log(`Password checker running at http://localhost:${PORT}`);
});
