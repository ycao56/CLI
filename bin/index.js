#! /usr/bin/env node
const { default: axios } = require("axios");
const { program } = require("commander");
const fsPromise = require("fs").promises;
const fs = require("fs");

const chalk = require("chalk");

const log = console.log;

program
  .name("Immich CLI Utilities")
  .description("Immich CLI Utilities toolset")
  .version("0.1.0");

program
  .command("upload")
  .description("Upload images and videos in a directory to Immich's server")
  .requiredOption("-e, --email <value>", "User's Email")
  .requiredOption("-pw, --password <value>", "User's Password")
  .requiredOption("-s, --server <value>", "Server IPv4")
  .requiredOption("-p, --port <value>", "Server Port")
  .requiredOption("-d, --directory <value>", "Target Directory")
  .action(upload);

program.parse(process.argv);

async function upload({ email, password, server, port, directory }) {
  const endpoint = `http://${server}:${port}`;

  // Ping server
  log("[1] Pinging server...");
  await pingServer(endpoint);

  // Login
  log("[2] Logging in...");
  const { accessToken, userId, userEmail } = await login(
    endpoint,
    email,
    password
  );
  log(chalk.yellow(`You are logged in as ${userEmail}`));

  // Check if directory exist
  log("[3] Checking directory...");
  if (fs.existsSync(directory)) {
    log(chalk.green("Directory status: OK"));
  } else {
    log(chalk.red("Error navigating to directory - check directory path"));
    process.exit(1);
  }
}

async function pingServer(endpoint) {
  try {
    const res = await axios.get(`${endpoint}/server-info/ping`);
    if (res.data["res"] == "pong") {
      log(chalk.green("Server status: OK"));
    }
  } catch (e) {
    log(
      chalk.red("Error connecting to server - check server address and port")
    );
    process.exit(1);
  }
}

async function login(endpoint, email, password) {
  try {
    const res = await axios.post(`${endpoint}/auth/login`, {
      email,
      password,
    });

    if (res.status == 201) {
      log(chalk.green("Login status: OK"));
      return res.data;
    }
  } catch (e) {
    log(chalk.red("Error logging in - check email and password"));
    process.exit(1);
  }
}
// node bin/index.js upload --email testuser@email.com --password password --server 192.168.1.216 --port 2283 -d /home/alex/Downloads/db6e94e1-ab1d-4ff0-a3b7-ba7d9e7b9d84
// node bin/index.js upload --help
