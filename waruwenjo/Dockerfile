# WaruWenJo wrapper frontend (Angular).
#
# Built only on GitHub-hosted ARM64 runners and published to GHCR; the Oracle
# server never runs this file.
#
# NOTE: this repository currently commits only waruwenjo/dist and one spec
# file — package.json / angular.json / src are absent, so the CI release job
# skips this image until the Angular sources are added (see
# docs/CICD-COOLIFY-DEPLOYMENT.md, "WaruWenJo wrapper"). The build layout below
# matches the committed output: waruwenjo/dist/waruwenjo/browser.

FROM node:22 AS builder
ENV VERSION=0.5.23
WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN npm run build

FROM docker.io/nginxinc/nginx-unprivileged:1.28-bookworm AS waruwenjo
COPY --from=builder /usr/src/app/dist/waruwenjo/browser/ /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
