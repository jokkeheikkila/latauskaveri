import express from "express";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (IS_PROD) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; ")
    );
  }
  next();
});

interface SpotPriceEntry {
  dateTime: string;
  priceWithTaxCents: number;
  priceNoTaxCents: number;
}

interface SpotPricePayload {
  success: true;
  prices: SpotPriceEntry[];
  isFallback: boolean;
  warning?: string;
}

// In-memory cache + in-flight request deduplication for porssisahko.net
// Prevents traffic spikes from hammering the upstream API.
const SPOT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000; // Retry upstream sooner after a failure
let cachedSpotData: { payload: SpotPricePayload; expiresAt: number } | null = null;
let inflightSpotRequest: Promise<SpotPricePayload> | null = null;

function buildFallbackPrices(): SpotPricePayload {
  const fallbackPrices: SpotPriceEntry[] = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < 48; i++) {
    const itemTime = new Date(startOfToday.getTime() + i * 60 * 60 * 1000);
    const hour = itemTime.getHours();

    let basePrice = 8.0;
    if (hour >= 1 && hour <= 5) {
      basePrice = 3.5 + hour * 0.3;
    } else if (hour >= 7 && hour <= 10) {
      basePrice = 12.5 + (hour - 7) * 0.5;
    } else if (hour >= 11 && hour <= 16) {
      basePrice = 7.5;
    } else if (hour >= 17 && hour <= 21) {
      basePrice = 14.0 - (hour - 17) * 0.8;
    } else {
      basePrice = 6.0;
    }

    const noise = Math.sin(i * 0.5) * 1.5;
    const finalWithTax = Math.max(0.1, basePrice + noise);
    const finalNoTax = finalWithTax / 1.255;

    fallbackPrices.push({
      dateTime: itemTime.toISOString(),
      priceWithTaxCents: parseFloat(finalWithTax.toFixed(3)),
      priceNoTaxCents: parseFloat(finalNoTax.toFixed(3)),
    });
  }

  return {
    success: true,
    prices: fallbackPrices,
    isFallback: true,
    warning: "Pörssisähkö-rajapintaan ei saatu yhteyttä. Käytetään arvioitua tuntihintakäyrää.",
  };
}

async function fetchLiveSpotPrices(): Promise<SpotPricePayload> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch("https://api.porssisahko.net/v1/latest-prices.json", {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "latauskaveri/1.0 (+https://latauskaveri.johei.fi)",
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !Array.isArray((data as { prices?: unknown }).prices)) {
      throw new Error("Invalid upstream payload format");
    }

    const prices: SpotPriceEntry[] = (data as { prices: unknown[] }).prices
      .filter((item): item is { startDate: string; price: number } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { startDate?: unknown; price?: unknown };
        return (
          typeof candidate.startDate === "string" &&
          !Number.isNaN(Date.parse(candidate.startDate)) &&
          typeof candidate.price === "number" &&
          Number.isFinite(candidate.price)
        );
      })
      .map((item) => {
        const priceWithTaxCents = item.price;
        const priceNoTaxCents = item.price / 1.255;
        return {
          dateTime: item.startDate,
          priceWithTaxCents: parseFloat(priceWithTaxCents.toFixed(3)),
          priceNoTaxCents: parseFloat(priceNoTaxCents.toFixed(3)),
        };
      })
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

    if (prices.length === 0) {
      throw new Error("Upstream returned zero valid price entries");
    }

    return {
      success: true,
      prices,
      isFallback: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getSpotPrices(): Promise<SpotPricePayload> {
  const now = Date.now();
  if (cachedSpotData && now < cachedSpotData.expiresAt) {
    return cachedSpotData.payload;
  }

  if (!inflightSpotRequest) {
    inflightSpotRequest = fetchLiveSpotPrices()
      .then((payload) => {
        cachedSpotData = {
          payload,
          expiresAt: Date.now() + SPOT_CACHE_TTL_MS,
        };
        return payload;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Failed to fetch live Finland hourly prices, using fallback:", message);
        // If we have stale live data, keep serving it briefly? Better: return fallback and retry in 2 min.
        const fallback = buildFallbackPrices();
        cachedSpotData = {
          payload: fallback,
          expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS,
        };
        return fallback;
      })
      .finally(() => {
        inflightSpotRequest = null;
      });
  }

  return inflightSpotRequest;
}

// Health check endpoint for Docker / reverse proxy monitoring
app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ status: "ok" });
});

// Hourly electricity spot prices for Finland (with caching & automatic fallback)
app.get("/api/spot-prices-today", async (_req, res) => {
  const payload = await getSpotPrices();
  res.setHeader(
    "Cache-Control",
    payload.isFallback ? "no-store" : "public, max-age=300"
  );
  return res.json(payload);
});

async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist", "client");
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        maxAge: "1y",
        immutable: true,
      })
    );
    app.use(
      express.static(distPath, {
        maxAge: "1h",
        setHeaders(res, filePath) {
          // Never long-cache index.html, service worker, or manifest
          if (
            filePath.endsWith(".html") ||
            filePath.endsWith("sw.js") ||
            filePath.endsWith("manifest.json")
          ) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Latauskaveri server running on http://0.0.0.0:${PORT} (${IS_PROD ? "production" : "development"})`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
