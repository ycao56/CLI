#! /usr/bin/env node
const { default: axios } = require("axios");
const { program } = require("commander");
const fsPromise = require("fs").promises;
const fs = require("fs");
const { fdir } = require("fdir");
const si = require("systeminformation");

// GLOBAL
const mime = require("mime-types");
const chalk = require("chalk");
const log = console.log;

const SUPPORTED_MIME = [
  // IMAGES
  "image/heif",
  "image/heic",
  "image/jpeg",
  "image/gif",
  "image/png",

  // VIDEO
  "video/mp4",
  "video/quicktime",
];

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
  const deviceId = (await si.uuid()).os;
  const osInfo = (await si.osInfo()).distro;
  const localAssets = [];
  const newAssets = [];

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

  // Index provided directory
  log("[4] Indexing files...");
  const api = new fdir().withFullPaths().crawl(directory);

  const files = await api.withPromise();

  for (const filePath of files) {
    const mimeType = mime.lookup(filePath);
    if (SUPPORTED_MIME.includes(mimeType)) {
      const fileStat = fs.statSync(filePath);

      localAssets.push({
        id: Math.round(
          fileStat.ctimeMs + fileStat.mtimeMs + fileStat.birthtimeMs
        ).toString(),
        filePath,
      });
    }
  }
  log(chalk.green("Indexing file: OK"));
  log(
    chalk.yellow(`Found ${localAssets.length} assets in specified directory`)
  );

  // Compare with server
  log("[5] Gathering device's asset info from server...");

  const backupAsset = await getAssetInfoFromServer(
    endpoint,
    accessToken,
    deviceId
  );

  localAssets.forEach((localAsset) => {
    if (!backupAsset.includes(localAsset.id)) {
      newAssets.push(localAsset);
    }
  });

  log(
    chalk.green(
      `A total of ${newAssets.length} assets will be uploaded to the server`
    )
  );
}

async function getAssetInfoFromServer(endpoint, accessToken, deviceId) {
  try {
    const res = await axios.get(`${endpoint}/asset/${deviceId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.data;
  } catch (e) {
    log(chalk.red("Error getting device's uploaded assets"));
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
// node bin/index.js upload --email testuser@email.com --password password --server 192.168.1.216 --port 2283 -d /Users/alex/Documents/immich-cli-upload-test-location
// node bin/index.js upload --help
