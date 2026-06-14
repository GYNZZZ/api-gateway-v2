const fs = require("fs");
const path = require("path");

const settingsFile = process.env.SETTINGS_FILE ? path.resolve(process.env.SETTINGS_FILE) : path.join(__dirname, "config", "settings.json");
const providersFile = process.env.PROVIDERS_FILE ? path.resolve(process.env.PROVIDERS_FILE) : path.join(__dirname, "config", "providers.json");
const modelsFile = process.env.MODELS_FILE ? path.resolve(process.env.MODELS_FILE) : path.join(__dirname, "config", "models.json");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function writeJson(file, data) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, file);
}
function readSettings() { return readJson(settingsFile); }
function readProviders() { return readJson(providersFile); }
function readModels() { return readJson(modelsFile); }
function updateSettings(changes) { const settings = { ...readSettings(), ...changes }; writeJson(settingsFile, settings); return settings; }
function saveProviders(providers) { writeJson(providersFile, providers); }
function saveModels(models) { writeJson(modelsFile, models); }

module.exports = { readSettings, readProviders, readModels, updateSettings, saveProviders, saveModels };
