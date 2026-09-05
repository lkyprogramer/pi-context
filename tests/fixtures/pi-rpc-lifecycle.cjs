const { createInterface } = require("node:readline");

createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.message === "no-ack") return;
  const response = `${JSON.stringify({ type: "response", id: command.id, success: true })}\n`;
  if (command.message === "exit-after-ack") {
    process.stdout.write(response, () => process.exit(0));
    return;
  }
  process.stdout.write(response);
  if (command.message === "no-settlement") return;
  process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
});
