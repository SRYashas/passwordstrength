import analyzerModule from "../lib/password-analyzer.js";

const { analyzePassword } = analyzerModule;

const MAX_PASSWORD_LENGTH = 256;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const rateLimitStore = new Map();

function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return "unknown";
}

function cleanupRateLimitStore(now) {
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

function checkRateLimit(request) {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const ip = getClientIp(request);
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

function validatePasswordInput(password) {
  if (typeof password !== "string") {
    throw new Error("Password must be a string.");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
  }

  return password;
}

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders
    }
  });
}

export async function POST(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { error: "Content-Type must be application/json." });
  }

  const rateLimit = checkRateLimit(request);
  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (!rateLimit.allowed) {
    return jsonResponse(
      429,
      { error: "Too many requests. Please retry later." },
      {
        ...rateLimitHeaders,
        "Retry-After": String(rateLimit.retryAfterSeconds)
      }
    );
  }

  try {
    const body = await request.json();
    const password = validatePasswordInput(body?.password ?? "");
    const result = await analyzePassword(password);
    return jsonResponse(200, result, rateLimitHeaders);
  } catch (error) {
    return jsonResponse(400, { error: error.message }, rateLimitHeaders);
  }
}

export async function GET() {
  return jsonResponse(405, { error: "Method not allowed" });
}