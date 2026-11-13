import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import noteRoutes from "./routes/noteRoutes.js";
import queryRoutes from "./routes/queryRoutes.js";

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());

// API Routes
app.use("/api", authRoutes);
app.use("/api", noteRoutes);
app.use("/api", queryRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;

