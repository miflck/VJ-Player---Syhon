#!/usr/bin/env node
// Standalone hub (no player window): node src/server/cli.js [--port 3000] [--token secret]
// Players on other machines connect to it with their config.json "remote.url".

const path = require("path");
const { startHub } = require("./hub");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(option("port", process.env.PORT || 3000));
const token = option("token", process.env.REMOTE_TOKEN || "");

startHub({ port, token, staticDir: path.join(__dirname, "..", "controller") })
  .then(() => console.log(`Remote hub listening on port ${port}${token ? " (token required)" : ""}`))
  .catch((error) => {
    console.error("Could not start the hub:", error.message);
    process.exit(1);
  });
