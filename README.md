# IMMICH CLI

CLI utilities to help with some operations with the Immich app

# Features

- Upload assets (videos/images) from a directory to IMMICH server

## Supported file type

### Image

- heif
- heic
- jpeg
- gif
- png

### Video

- mp4
- quicktime

# Getting Started

### Install from NPM

1 - Install from NPM repository

```
npm i -g immich
```

2 - Run

Specify user's credential, Immich's server address and port and the directory you would like to upload videos/photos from.

```
immich upload --email testuser@email.com --password password --server http://192.168.1.216:2283/api -d your/target/directory
```

---

### Install from source

1 - Clone Repository

```
git clone https://github.com/alextran1502/immich-cli
```

2 - Install dependencies

```
npm install
```

3 - Run

```
node bin/index.js upload --email testuser@email.com --password password --server http://192.168.1.216:2283/api -d your/target/directory
```
