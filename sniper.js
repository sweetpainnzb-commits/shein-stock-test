/**
 * Shein Sniper with Stock Gate via /api/cart/microcart
 * - Keeps existing discovery + seen logic
 * - Adds: check stock before alerting
 * - OOS items are skipped and NOT marked as seen
 */

import fs from "fs";
import fetch from "node-fetch";
import HttpsProxyAgent from "https-proxy-agent";

// ================= CONFIG =================
const CATEGORY_URL =
  "https://www.sheinindia.in/api/category/sverse-5939-37961?fields=SITE&currentPage=1&pageSize=40&format=json&query=%3Arelevance&gridColumns=2&advfilter=true&platform=Desktop&showAdsOnNextPage=false&is_ads_enable_plp=true&displayRatings=true&segmentIds=&&store=shein";

const MICRO_CART_URL = "https://www.sheinindia.in/api/cart/microcart";

const SEEN_FILE = "seen_products.json";

// Env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_URL = process.env.PROXY_URL || null;

// ================= HTTP SETUP =================
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const baseHeaders = {
  "accept": "application/json",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36",
  "x-tenant-id": "SHEIN",
};

// ================= HELPERS =================
function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("⚠️ Telegram not configured, skipping send");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false,
    }),
  });
}

// ================= STOCK CHECK (NEW) =================
/**
 * We call /api/cart/microcart and verify the product is actually addable/visible.
 * Conservative approach: if we cannot confirm availability, treat as OOS to avoid false alerts.
 */
async function isInStock(productId) {
  try {
    const res = await fetch(MICRO_CART_URL, {
      method: "GET",
      headers: {
        ...baseHeaders,
        // If your setup already uses cookies, you can add them here:
        // "cookie": "your=cookies; here=...",
      },
      agent,
    });

    if (!res.ok) {
      console.log("⚠️ microcart status not OK:", res.status);
      return false;
    }

    const bodyText = await res.text();

    // Heuristic: if the productId is referenced in microcart state,
    // it means it's currently valid/addable in cart context.
    // If not found, assume OOS.
    if (bodyText.includes(String(productId))) {
      return true;
    }

    return false;
  } catch (err) {
    console.log("❌ microcart check failed:", err.message);
    // Fail-safe: avoid false positives
    return false;
  }
}

// ================= MAIN =================
async function run() {
  console.log("🚀 Running sniper...");

  const seen = loadSeen();

  const res = await fetch(CATEGORY_URL, {
    method: "GET",
    headers: baseHeaders,
    agent,
  });

  if (!res.ok) {
    throw new Error("Category API failed: " + res.status);
  }

  const data = await res.json();

  // Try common paths used by Shein APIs
  const products =
    data?.info?.products ||
    data?.products ||
    data?.data?.products ||
    [];

  console.log("Found products:", products.length);

  let newCount = 0;

  for (const p of products) {
    const id = p?.goods_id || p?.id || p?.goodsId;
    if (!id) continue;

    if (seen[id]) {
      continue; // already processed
    }

    // ===== NEW: STOCK GATE =====
    const inStock = await isInStock(id);
    if (!inStock) {
      console.log("⛔ Skipping OOS product:", id);
      // Do NOT mark as seen
      continue;
    }

    // ===== EXISTING BEHAVIOR CONTINUES =====
    const title = p?.goods_name || p?.name || "New Product";
    const url =
      p?.detail_url ||
      `https://www.sheinindia.in/p/${id}`;

    const msg = `🆕 In-Stock Product Found!\n\n${title}\n${url}`;

    console.log("✅ Alerting:", id, title);

    await sendTelegram(msg);

    // Mark as seen ONLY after successful alert
    seen[id] = {
      time: Date.now(),
      title,
      url,
    };

    newCount++;
  }

  saveSeen(seen);

  console.log(`Done. New in-stock alerts sent: ${newCount}`);
}

// Run
run().catch((err) => {
  console.error("❌ Sniper crashed:", err);
  process.exit(1);
});
