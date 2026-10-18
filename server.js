import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
const port = Number(process.env.PORT || 3000);
const pistonBase = (process.env.PISTON_API_URL || "").trim().replace(/\/+$/, "");
const frontendOrigin = (process.env.FRONTEND_ORIGIN || "https://clarity-94na.onrender.com").trim();

app.disable("x-powered-by");
app.use(cors({
  origin: frontendOrigin.split(",").map((s) => s.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "32kb", strict: true }));

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many execution requests. Please wait a minute and try again." }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "clarity-code-runner-api", runnerConfigured: Boolean(pistonBase) });
});

function normalizeLanguage(language) {
  const value = String(language || "").toLowerCase().trim();
  if (["python", "py"].includes(value)) return "python";
  if (["javascript", "js", "node"].includes(value)) return "javascript";
  return null;
}

app.post("/api/execute", executeLimiter, async (req, res) => {
  if (!pistonBase) {
    return res.status(503).json({
      error: "Code execution is not configured. Set PISTON_API_URL on the backend to a reachable private Piston runner."
    });
  }

  const language = normalizeLanguage(req.body?.language);
  const code = req.body?.code;
  const stdin = req.body?.stdin ?? "";

  if (!language) {
    return res.status(400).json({ error: "Unsupported language. Choose Python or JavaScript." });
  }
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "Please enter some code to run." });
  }
  if (code.length > 20000) {
    return res.status(413).json({ error: "Code is too long. Maximum is 20,000 characters." });
  }
  if (typeof stdin !== "string" || stdin.length > 5000) {
    return res.status(400).json({ error: "Input must be text and no longer than 5,000 characters." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    // Resolve an installed runtime version instead of assuming a specific version exists.
    const runtimeResponse = await fetch(`${pistonBase}/api/v2/runtimes`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    if (!runtimeResponse.ok) {
      return res.status(502).json({ error: "Could not retrieve runtimes from the Piston service." });
    }

    const runtimes = await runtimeResponse.json();
    const aliases = language === "python" ? ["python"] : ["javascript", "node"];
    const runtime = runtimes.find((item) => aliases.includes(String(item.language).toLowerCase()));
    if (!runtime?.version) {
      return res.status(503).json({ error: `The Piston runner has no installed ${language} runtime.` });
    }

    const executeResponse = await fetch(`${pistonBase}/api/v2/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: language === "python" ? "main.py" : "main.js", content: code }],
        stdin,
        args: [],
        compile_timeout: 5000,
        run_timeout: 5000,
        compile_memory_limit: 128000000,
        run_memory_limit: 128000000
      }),
      signal: controller.signal
    });

    if (!executeResponse.ok) {
      return res.status(502).json({ error: "The Piston runner rejected the execution request." });
    }

    const data = await executeResponse.json();
    return res.json({
      language,
      output: data.run?.stdout ?? "",
      stderr: data.run?.stderr ?? data.compile?.stderr ?? "",
      status: data.run?.code ?? data.compile?.code ?? null,
      signal: data.run?.signal ?? data.compile?.signal ?? null,
      timedOut: Boolean(data.run?.signal === "SIGKILL" || data.run?.code === 124)
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "The code runner timed out. Try a shorter program." });
    }
    console.error("Execution request failed:", error?.message || error);
    return res.status(502).json({ error: "Could not connect to the Piston runner. Check PISTON_API_URL and service networking." });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  console.error("API error:", err?.message || err);
  res.status(400).json({ error: "Invalid request." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Clarity code runner API listening on port ${port}`);
});
