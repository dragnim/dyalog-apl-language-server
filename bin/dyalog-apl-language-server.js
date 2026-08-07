#!/usr/bin/env node
// Entry point for editors other than VS Code. They launch this over stdio.
if (!process.argv.includes('--stdio')) process.argv.push('--stdio');
require('../out/server.js');
