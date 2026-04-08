#!/bin/bash
bun run build && npx @vscode/vsce package --no-dependencies
