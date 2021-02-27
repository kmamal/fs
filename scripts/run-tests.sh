#!/usr/bin/env bash

set -eEu -o pipefail

shopt -s globstar nullglob
node node_modules/@xyz/testing src/**/*.test.js
