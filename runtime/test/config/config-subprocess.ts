const initialEnv = { ...process.env };
const config = await import("../../src/core/config.js");

const requested = (process.env.PICLAW_CONFIG_EXPORTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const values = config as Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (typeof value === "number" && Number.isNaN(value)) {
    return { type: "number", value: "NaN" };
  }
  if (value instanceof RegExp) {
    return { type: "regexp", source: value.source, flags: value.flags };
  }
  return value;
}

function resolveRequestedValue(name: string): unknown {
  if (name.startsWith('has:')) return Object.hasOwn(values,name.slice(4));
  if (name.startsWith("call:")) {
    const fnName = name.slice(5);
    const fn = values[fnName];
    if (typeof fn !== "function") {
      throw new Error(`Unknown config getter requested: ${fnName}`);
    }
    return serialize(fn.call(config));
  }

  if (name.startsWith("env:")) {
    return process.env[name.slice(4)] ?? null;
  }

  if (name.startsWith("env-initial:")) {
    return initialEnv[name.slice(12)] ?? null;
  }

  if (name.startsWith("env-unchanged:")) {
    const key = name.slice(14);
    return (process.env[key] ?? null) === (initialEnv[key] ?? null);
  }

  if (name.startsWith("same:")) {
    const [fnName, exportName] = name.slice(5).split(":");
    const fn = values[fnName];
    if (typeof fn !== "function" || !(exportName in values)) {
      throw new Error(`Unknown config identity check requested: ${name}`);
    }
    return fn.call(config) === values[exportName];
  }

  if (name.startsWith("frozen:")) {
    const exportName = name.slice(7);
    if (!(exportName in values)) {
      throw new Error(`Unknown config freeze check requested: ${exportName}`);
    }
    return Object.isFrozen(values[exportName]);
  }

  if (name.startsWith("sealed:")) {
    const exportName = name.slice(7);
    if (!(exportName in values)) {
      throw new Error(`Unknown config seal check requested: ${exportName}`);
    }
    return Object.isSealed(values[exportName]);
  }

  if (!(name in values)) {
    throw new Error(`Unknown config export requested: ${name}`);
  }
  return serialize(values[name]);
}

const output = Object.fromEntries(
  requested.map((name) => [name, resolveRequestedValue(name)])
);

console.log(JSON.stringify(output));
