import mongoose from "mongoose";

/**
 * Connect to MongoDB Atlas.
 * Validates connection URI and handles connection errors.
 */
export async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri || mongoUri.includes("<username>")) {
    console.error("❌ MONGODB_URI is missing or contains placeholder values in server/.env");
    console.error("Please update server/.env with your actual MongoDB Atlas connection string.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB Atlas...");
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB Atlas successfully");
  } catch (error) {
    console.error("❌ MongoDB Atlas connection error:", error.message);
    console.error("Server stopped. Ensure your IP address is whitelisted in Atlas Network Access and credentials are correct.");
    process.exit(1);
  }
}

