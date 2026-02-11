import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.resolve(__dirname, "../../../cloud-init/template.yaml");

function escapeForTemplate(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

export function renderCloudInit(params) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Cloud-init template not found: ${TEMPLATE_PATH}`);
  }

  let template = fs.readFileSync(TEMPLATE_PATH, "utf8");

  const replacements = {
    __PROFILE__: escapeForTemplate(params.profile),
    __DOMAIN__: escapeForTemplate(params.domain || "_"),
    __MODEL__: escapeForTemplate(params.model),
    __AGENT_NAME__: escapeForTemplate(params.agentName),
    __ANTHROPIC_KEY__: escapeForTemplate(params.anthropicKey || ""),
    __DISCORD_TOKEN__: escapeForTemplate(params.discordToken || ""),
  };

  for (const [token, value] of Object.entries(replacements)) {
    template = template.replaceAll(token, value);
  }

  // This token is embedded as raw JSON.
  template = template.replaceAll("__CHANNEL_CONFIG__", JSON.stringify(params.channelConfig));

  return template;
}
