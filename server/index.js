import "dotenv/config";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // 1. Establish database connection first
    await connectDB();

    // 2. Begin accepting incoming HTTP traffic
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Fatal error during server startup:", error.message);
    process.exit(1);
  }
}

startServer();
