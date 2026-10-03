import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";

/** Mounts the agent backend (server/api.ts) into the dev server at /api/*.
 * server/ code runs in Node, so the Claude API key never reaches the browser. */
function agentsApi(): Plugin {
  const mount = (server: ViteDevServer) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();
      try {
        const mod = await server.ssrLoadModule("/server/api.ts");
        await mod.handle(req, res);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });
  };
  return { name: "agents-api", configureServer: mount };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const k of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GEMINI_MODEL", "LLM_PROVIDER", "ANTHROPIC_MODEL", "CLAUDE_EFFORT", "CLAUDE_FALLBACKS"]) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  return {
    plugins: [react(), agentsApi()],
    server: { port: 5173, watch: { ignored: ["**/.data/**"] } },
  };
});
