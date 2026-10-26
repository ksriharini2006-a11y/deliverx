/*
 * httpClient.js - tiny wrapper around Node's built-in fetch (Node 18+) with
 * a timeout, an identifying User-Agent, one retry for temporary failures
 * (HTTP 429/502/503/504) and a minimal "at most one request per N ms" gate
 * so we respect the public servers' usage policies.
 */

const config = require("./config");
const { ApiError } = require("./errors");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns a function that runs tasks one at a time, at least `minGapMs` apart.
function createThrottle(minGapMs) {
  let last = 0;
  let queue = Promise.resolve();
  return function schedule(task) {
    const run = queue.then(async () => {
      const wait = Math.max(0, last + minGapMs - Date.now());
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  };
}

async function fetchOnce(url, { headers, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a URL and parse JSON. Throws ApiError(503, `${service}_UNAVAILABLE`) on
 * network failure/timeouts, ApiError(429/502) on provider errors/bad bodies.
 */
async function getJson(url, { service, headers = {}, timeoutMs = config.HTTP_TIMEOUT_MS, retries = 1 } = {}) {
  const allHeaders = { "User-Agent": config.USER_AGENT, Accept: "application/json", ...headers };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(url, { headers: allHeaders, timeoutMs });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new ApiError(
          res.status === 429 ? 429 : 503,
          res.status === 429 ? `${service}_RATE_LIMITED` : `${service}_UNAVAILABLE`,
          res.status === 429
            ? `The ${service.toLowerCase()} service is rate-limiting requests. Wait a few seconds and try again.`
            : `The ${service.toLowerCase()} service is temporarily unavailable (HTTP ${res.status}).`
        );
        if (attempt < retries) {
          await sleep(1200);
          continue;
        }
        throw lastErr;
      }
      let body;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiError(502, `${service}_BAD_RESPONSE`, `The ${service.toLowerCase()} service returned something that is not JSON.`);
      }
      if (!res.ok && body && (body.message || body.error)) {
        // e.g. OSRM answers 400 with {code:"InvalidQuery", message:"..."}
        return { httpStatus: res.status, body };
      }
      return { httpStatus: res.status, body };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastErr = new ApiError(
        503,
        `${service}_UNAVAILABLE`,
        err.name === "AbortError"
          ? `The ${service.toLowerCase()} service did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : `Could not reach the ${service.toLowerCase()} service (${err.message}). Check your internet connection.`
      );
      if (attempt < retries) {
        await sleep(800);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

module.exports = { getJson, createThrottle, sleep };
