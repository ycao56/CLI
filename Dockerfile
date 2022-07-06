FROM node:16-alpine3.14 as core

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm install -g

WORKDIR /import
ENTRYPOINT [ "immich" ]