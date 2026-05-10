const { spawn } = require("child_process");
const fs = require("fs");

const command = process.argv.slice(2).join(" ");

const logStream = fs.createWriteStream("error.log", { flags: "w" });

const proc = spawn(command, {
  shell: true,
});

proc.stdout.on("data", (data) => {
  process.stdout.write(data);
});

proc.stderr.on("data", (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

proc.on("close", () => {
  logStream.end();
});