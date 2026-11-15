import fs from "node:fs";
import http from "node:http";
const phase = process.argv[2];
fs.appendFileSync("calls.txt", `${phase}\n`);
if (phase === "build") {
  if (fs.existsSync("build-fails")) process.exit(1);
  if (fs.existsSync("hang-build")) setInterval(() => {}, 1_000);
  if (!fs.existsSync("offline-fails")) {
    fs.mkdirSync(".next/server/app", { recursive: true }); fs.mkdirSync(".next/static/chunks", { recursive: true });
    fs.writeFileSync(".next/server/app/offline.html", "<html>static fixture</html>"); fs.writeFileSync(".next/BUILD_ID", "fixture-build");
    fs.writeFileSync(".next/static/chunks/offline-fixture.js", "/* public fixture */");
  }
} else if (phase === "start") {
  if (fs.existsSync("start-fails")) process.exit(1);
  fs.writeFileSync("started.json", JSON.stringify({ args: process.argv.slice(3), origin: process.env.APP_ORIGIN, mode: process.env.NODE_ENV }));
  const server = http.createServer((_request, response) => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ app: "novel-ai-editor", launchId: process.env.NOVEL_EDITOR_LAUNCH_ID })));
  server.listen(3_000, "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
} else process.exit(1);
