import express from "express";
import cors from "cors";
import axios from "axios";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const BASE_URL = "https://api.coingecko.com/api/v3";

// Cache responses for 5 minutes
const cache = new NodeCache({ stdTTL: 300 });

// Rate limit: Max 5 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Adjust based on your API needs
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// Exponential Backoff with Request Queue
const requestQueue = [];
const processQueue = async () => {
  while (requestQueue.length) {
    const { url, resolve, reject, attempt = 1 } = requestQueue.shift();
    try {
      console.log(`Fetching from API (Attempt ${attempt}): ${url}`);
      const response = await axios.get(url);
      cache.set(url, response.data);
      resolve(response.data);
    } catch (error) {
      if (error.response?.status === 429 && attempt < 3) {
        const retryDelay = attempt * 3000; // Increase delay (3s, 6s, 9s...)
        console.warn(`Rate limit hit. Retrying in ${retryDelay}ms...`);
        setTimeout(() => {
          requestQueue.push({ url, resolve, reject, attempt: attempt + 1 });
          processQueue();
        }, retryDelay);
      } else {
        reject(error);
      }
    }
    await new Promise((res) => setTimeout(res, 1000)); // Delay between requests
  }
};

// Fetch data from API (with queue)
const fetchData = async (url) => {
  if (cache.has(url)) {
    console.log(`Cache hit for ${url}`);
    return cache.get(url);
  }
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, resolve, reject });
    if (requestQueue.length === 1) processQueue(); // Start processing queue if it's empty
  });
};

// Routes
app.get("/api/coins", async (req, res) => {
  try {
    const url = `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false`;
    const data = await fetchData(url);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch coin data" });
  }
});

app.get("/api/coin/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${BASE_URL}/coins/${id}`;
    const data = await fetchData(url);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch data for coin: ${id}` });
  }
});

app.get("/api/prices/:id", async (req, res) => {
  const { id } = req.params;
  const { days = 30, priceType = "prices" } = req.query;

  try {
    const url = `${BASE_URL}/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const data = await fetchData(url);

    if (priceType === "market_caps") {
      res.json(data.market_caps);
    } else if (priceType === "total_volumes") {
      res.json(data.total_volumes);
    } else {
      res.json(data.prices);
    }
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch price data for ${id}` });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
