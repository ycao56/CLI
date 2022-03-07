#! /usr/bin/env node
const { default: axios } = require("axios");
const { program } = require("commander");
const fsPromise = require("fs").promises;
const fs = require("fs");
const { fdir } = require("fdir");
const si = require("systeminformation");
const readline = require("readline");
var path = require("path");
var FormData = require("form-data");
const cliProgress = require("cli-progress");

// GLOBAL
const mime = require("mime-types");
const chalk = require("chalk");
const log = console.log;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const util = require("util");
const { stat } = require("fs/promises");
const question = util.promisify(rl.question).bind(rl);

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

  // Find assets that has not been backup
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

  if (newAssets.length == 0) {
    log(chalk.green("All assets have been backup to the server"));
    process.exit(0);
  } else {
    log(
      chalk.green(
        `A total of ${newAssets.length} assets will be uploaded to the server`
      )
    );
  }

  // Ask user
  const answer = await question("Do you want to start upload now? (y/n) ");

  if (answer == "n") {
    log(chalk.yellow("Abort Upload Process"));
    process.exit(1);
  }

  if (answer == "y") {
    log(chalk.green("Start uploading..."));
    const progressBar = new cliProgress.SingleBar(
      {},
      cliProgress.Presets.shades_classic
    );
    progressBar.start(newAssets.length, 0);

    await Promise.all(
      newAssets.map(async (asset) => {
        const res = await startUpload(endpoint, accessToken, asset, deviceId);
        if (res == "ok") {
          progressBar.increment();
        }
      })
    );

    progressBar.stop();

    process.exit(0);
  }
}

async function startUpload(endpoint, accessToken, asset, deviceId) {
  try {
    const assetType = getAssetType(asset.filePath);
    const fileStat = await stat(asset.filePath);
    var data = new FormData();
    data.append("deviceAssetId", asset.id);
    data.append("deviceId", deviceId);
    data.append("assetType", assetType);
    data.append("createdAt", fileStat.mtime.toISOString());
    data.append("modifiedAt", fileStat.mtime.toISOString());
    data.append("isFavorite", JSON.stringify(false));
    data.append("fileExtension", path.extname(asset.filePath));
    data.append(
      "duration",
      assetType == "IMAGE" ? JSON.stringify(null) : "0:00:00.000000"
    );
    data.append("files", fs.createReadStream(asset.filePath));

    const config = {
      method: "post",
      url: `${endpoint}/asset/upload`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...data.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      data: data,
    };

    const res = await axios(config);

    return res.data;
  } catch (e) {
    log(chalk.red("\nError uploading asset", e));
  }
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

function getAssetType(filePath) {
  const mimeType = mime.lookup(filePath);

  return mimeType.split("/")[0].toUpperCase();
}

// node bin/index.js upload --email testuser@email.com --password password --server 192.168.1.216 --port 2283 -d /home/alex/Downloads/db6e94e1-ab1d-4ff0-a3b7-ba7d9e7b9d84
// node bin/index.js upload --email testuser@email.com --password password --server 192.168.1.216 --port 2283 -d /Users/alex/Documents/immich-cli-upload-test-location
// node bin/index.js upload --help
