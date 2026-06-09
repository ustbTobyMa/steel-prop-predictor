import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const repoRoot = new URL("../", import.meta.url);
const predictorUrl = new URL("../docs/browser-predictor.js", import.meta.url);
const { predictInBrowser } = await import(predictorUrl.href);

globalThis.fetch = async (url) => {
  const resolved = new URL(url, new URL("../docs/", import.meta.url));
  const body = await readFile(resolved);
  return {
    ok: true,
    status: 200,
    async json() {
      return JSON.parse(body.toString("utf8"));
    },
  };
};

const payload = {
  material_subclass: "alloy_steel",
  process_text: "900C quench + 600C temper",
  composition: {
    C: 0.18,
    Mn: 0.8,
    Si: 0.25,
    Cr: 1.0,
    Ni: 1.2,
    Mo: 0.2,
  },
};

const expected = JSON.parse(await readFile(new URL("./browser_predictor_expected.json", import.meta.url), "utf8"));
const actual = await predictInBrowser(payload, "./models/");

assert.ok(actual.explanation.thermo_reference, "browser predictor should include a compact thermo reference");
assert.ok(
  actual.explanation.thermo_reference.reference_material?.material_name,
  "thermo reference should include nearest material metadata",
);
assert.ok(
  actual.explanation.thermo_reference.thermo_metrics?.some((item) => item.key === "ae1_c" && Number.isFinite(item.value)),
  "thermo reference should include compact numeric thermodynamic metrics",
);

for (const [groupName, group] of Object.entries(expected.predictions)) {
  for (const [target, expectedValue] of Object.entries(group)) {
    const actualValue = actual.predictions[groupName][target].value;
    assert.ok(Math.abs(actualValue - expectedValue) < 1e-9, `${target}: ${actualValue} != ${expectedValue}`);
  }
}

console.log("browser predictor matches Python reference");
