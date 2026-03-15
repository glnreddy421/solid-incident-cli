import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG, SolidConfig } from "../contracts/index.js";

const CONFIG_DIR = join(homedir(), ".solid");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<SolidConfig> {
  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as Partial<SolidConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: SolidConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function setConfigKey(key: keyof SolidConfig, value: string): Promise<SolidConfig> {
  const current = await loadConfig();
  let typed: SolidConfig[keyof SolidConfig];
  if (value === "true") typed = true as SolidConfig[keyof SolidConfig];
  else if (value === "false") typed = false as SolidConfig[keyof SolidConfig];
  else typed = value as SolidConfig[keyof SolidConfig];

  const next = { ...current, [key]: typed } as SolidConfig;
  await saveConfig(next);
  return next;
}

