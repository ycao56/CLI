#! /usr/bin/env node
const {default: axios} = require("axios");
const {program, Option} = require("commander");
const fs = require("fs");
const {fdir} = require("fdir");
const si = require("systeminformation");
const readline = require("readline");
const path = require("path");
const FormData = require("form-data");
const cliProgress = require("cli-progress");
const {stat} = require("fs/promises");
const exifr = require("exifr");
var pjson = require("../package.json");
// GLOBAL
const mime = require("mime-types");
const chalk = require("chalk");
const log = console.log;
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
let errorAssets = [];

const SUPPORTED_MIME = [
    // IMAGES
    "image/heif",
    "image/heic",
    "image/jpeg",
    "image/png",

    // VIDEO
    "video/mp4",
    "video/quicktime",
];

program
    .name("Immich CLI Utilities")
    .description("Immich CLI Utilities toolset")
    .version(pjson.version);

program
    .command("upload")
    .description("Upload images and videos in a directory to Immich's server")
    .addOption(
        new Option("-e, --email <value>", "User's Email").env("IMMICH_USER_EMAIL")
    )
    .addOption(
        new Option("-pw, --password <value>", "User's Password").env(
            "IMMICH_USER_PASSWORD"
        )
    )
    .addOption(
        new Option(
            "-s, --server <value>",
            "Server address (http://<your-ip>:2283/api or https://<your-domain>/api)"
        ).env("IMMICH_SERVER_ADDRESS")
    )
    .addOption(
        new Option("-d, --directory <value>", "Target Directory").env(
            "IMMICH_TARGET_DIRECTORY"
        )
    )
    .addOption(
        new Option("-y, --yes", "Assume yes on all interactive prompts").env(
            "IMMICH_ASSUME_YES"
        )
    )
    .addOption(
        new Option("-da, --delete", "Delete local assets after upload").env(
            "IMMICH_DELETE_ASSETS"
        )
    )
    .action(upload);

program.parse(process.argv);

async function upload({email, password, server, directory, yes: assumeYes, delete: deleteAssets}) {
    const endpoint = server;
    const deviceId = (await si.uuid()).os || "CLI";
    const osInfo = (await si.osInfo()).distro;
    const localAssets = [];
    const newAssets = [];
    console.log(deleteAssets)

    // Ping server
    log("[1] Pinging server...");
    await pingServer(endpoint);

    // Login
    log("[2] Logging in...");
    const {accessToken, userId, userEmail} = await login(
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
    try {
        //There is a promise API for readline, but it's currently experimental
        //https://nodejs.org/api/readline.html#promises-api
        const answer = assumeYes
            ? "y"
            : await new Promise((resolve) => {
                rl.question("Do you want to start upload now? (y/n) ", resolve);
            });
        const deleteLocalAsset = deleteAssets ? "y" : "n";

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

            for (const asset of newAssets) {
                try {
                    const res = await startUpload(endpoint, accessToken, asset, deviceId);

                    if (res && res.status == 201) {
                        progressBar.increment();
                        if (deleteLocalAsset == "y") {
                            fs.unlink(asset.filePath, (err) => {
                                if (err) {
                                    console.log(err)
                                    return
                                }
                            })

                        }
                    }
                } catch (err) {
                    log(chalk.red(err.message));
                }
            }

            progressBar.stop();

            log(
                chalk.yellow(`Failed to upload ${errorAssets.length} files `),
                errorAssets
            );

            if (errorAssets.length > 0) {
                process.exit(1);
            }

            process.exit(0);
        }
    } catch (e) {
        log(chalk.red("Error reading input from user "), e);
        process.exit(1);
    }
}

async function startUpload(endpoint, accessToken, asset, deviceId) {
    try {
        const assetType = getAssetType(asset.filePath);
        const fileStat = await stat(asset.filePath);

        let exifData = null;
        if (assetType != "VIDEO") {
            exifData = await exifr.parse(asset.filePath, {
                tiff: true,
                ifd0: true,
                ifd1: true,
                exif: true,
                gps: true,
                rop: true,
                xmp: true,
                icc: true,
                iptc: true,
                jfif: true,
                ihdr: true,
            });
        }

        const createdAt =
            exifData && exifData.DateTimeOriginal != null
                ? new Date(exifData.DateTimeOriginal).toISOString()
                : fileStat.mtime.toISOString();

        var data = new FormData();
        data.append("deviceAssetId", asset.id);
        data.append("deviceId", deviceId);
        data.append("assetType", assetType);
        data.append("createdAt", createdAt);
        data.append("modifiedAt", fileStat.mtime.toISOString());
        data.append("isFavorite", JSON.stringify(false));
        data.append("fileExtension", path.extname(asset.filePath));
        data.append("duration", "0:00:00.000000");

        data.append("assetData", fs.createReadStream(asset.filePath));

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
        return res;
    } catch (e) {
        errorAssets.push({file: asset.filePath, reason: e});
        return null;
    }
}

async function getAssetInfoFromServer(endpoint, accessToken, deviceId) {
    try {
        const res = await axios.get(`${endpoint}/asset/${deviceId}`, {
            headers: {Authorization: `Bearer ${accessToken}`},
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

// node bin/index.js upload --email testuser@email.com --password password --server http://192.168.1.216:2283/api -d /Users/alex/Documents/immich-cli-upload-test-location
// node bin/index.js upload --help
