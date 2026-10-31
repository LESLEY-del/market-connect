// Keeps the phone app from ever bundling the server code in the backend folder
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.blockList = [/[\/\\]backend[\/\\].*/];
module.exports = config;
