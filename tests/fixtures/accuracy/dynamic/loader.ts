export async function loadPlugin(name: string) {
  // dynamic import — should be detected
  const mod = await import(`./plugins/${name}.js`);
  return mod.default;
}

export async function loadConfig() {
  const { readFile } = await import("fs/promises");
  return readFile("config.json", "utf8");
}
