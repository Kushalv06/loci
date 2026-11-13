import { Router } from "express";

const router = Router();

/**
 * GET /api/token
 * Generate temporary single-use streaming token for AssemblyAI v3.
 */
router.get("/token", async (req, res) => {
  try {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error("❌ ASSEMBLYAI_API_KEY is missing in server/.env");
      return res.status(500).json({ error: "ASSEMBLYAI_API_KEY is not configured in server/.env" });
    }

    const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=60", {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ AssemblyAI token error:", response.status, errText);
      return res.status(response.status).json({ error: `AssemblyAI token error: ${errText}` });
    }

    const data = await response.json();
    res.json({ token: data.token });
  } catch (error) {
    console.error("Error generating AssemblyAI streaming token:", error.message);
    res.status(500).json({ error: "Failed to generate streaming token" });
  }
});

export default router;

