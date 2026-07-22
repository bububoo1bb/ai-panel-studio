import dotenv from "dotenv";
import { createApp } from "./app.js";
import { loadAppConfig } from "./config/AppConfig.js";
import { createAIService } from "./ai/createAIService.js";

dotenv.config();

// Load and validate application configuration from environment variables.
// This is the composition root — the single place where configuration is
// read and concrete implementations are selected.
const config = loadAppConfig(process.env);
const aiService = createAIService(config.ai);

const app = createApp({ aiService });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
