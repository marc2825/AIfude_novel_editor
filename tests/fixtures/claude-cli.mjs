#!/usr/bin/env node
// Local test executable only: no credentials, network, tools, or manuscript logs.
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ authMethod: "claude.ai" }));
} else {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text);
  const model = args[args.indexOf("--model") + 1];
  if (!args.includes("--no-session-persistence") || !args.includes("--safe-mode") || args[args.indexOf("--tools") + 1] !== "" || process.env.ANTHROPIC_API_KEY) process.exit(1);
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, modelUsage: { [model]: {} },
    result: JSON.stringify({ candidates: Array.from({ length: input.candidateCount }, (_, index) => ({ replacementText: `Claudeの比較候補${index + 1}`, explanation: "テスト用の回答", riskNotes: [] })) }) }));
}
