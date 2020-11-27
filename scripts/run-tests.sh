#!/usr/bin/env bash

set -e

shopt -s globstar nullglob
node node_modules/@xyz/testing src/**/*.test.js
