import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATIVE_FORMATS,
  fallbackArtboard,
  normalizeCreativePlan,
  validateArtboardPatch,
  type CreativeSetPlan,
} from "./creative.js";
import { compileArtboard } from "./compiler.js";

const plan: CreativeSetPlan = {
  title: "Design systems",
  concept: "Um carrossel editorial sobre consistência visual.",
  theme: {
    colors: {
      background: "#0b0b0d",
      surface: "#16161c",
      text: "#f5f3ef",
      muted: "#9c9aa0",
      primary: "#c6f24e",
      primaryText: "#10120a",
      accent: "#8b7bff",
      border: "#2a2a35",
    },
    radius: "24px",
    spacing: "24px",
  },
  formatId: "ig-portrait",
  artboards: [{ id: "cover", role: "cover", brief: "Abrir com a promessa central." }],
};

test("normalizeCreativePlan pads and caps the requested card count", () => {
  const padded = normalizeCreativePlan(plan, 4);
  assert.equal(padded.artboards.length, 4);
  assert.equal(padded.artboards[0]?.role, "cover");
  assert.equal(padded.artboards[2]?.role, "proof");
  assert.equal(new Set(padded.artboards.map((artboard) => artboard.id)).size, 4);
  assert.equal(normalizeCreativePlan(plan, 99).artboards.length, 8);
  assert.equal(normalizeCreativePlan(plan, 0).artboards.length, 1);
});

test("validateArtboardPatch enforces the artboard root, text and fixed size", () => {
  const accepted = validateArtboardPatch(
    {
      artboardId: "cover",
      node: {
        id: "cover",
        type: "artboard",
        children: [{ id: "headline", type: "heading", text: "Design que escala" }],
      },
    },
    plan,
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.node.id, "cover");
    assert.equal(accepted.node.children?.[0]?.id, "cover-headline");
    assert.equal(accepted.node.style?.width, "1080px");
    assert.equal(accepted.node.style?.height, "1350px");
  }
  assert.equal(
    validateArtboardPatch({ artboardId: "missing", node: { id: "root", type: "artboard" } }, plan).ok,
    false,
  );
  assert.equal(
    validateArtboardPatch({ artboardId: "cover", node: { id: "root", type: "section" } }, plan).ok,
    false,
  );
  assert.equal(
    validateArtboardPatch({ artboardId: "cover", node: { id: "root", type: "artboard" } }, plan).ok,
    false,
  );
});

test("fallback artboards and compiled HTML are sized for the selected format", () => {
  const node = fallbackArtboard(plan.artboards[0]!, plan);
  assert.equal(node.type, "artboard");
  assert.equal(node.children?.some((child) => child.type === "heading"), true);
  const html = compileArtboard({
    title: "Card de teste",
    plan,
    root: node,
    width: CREATIVE_FORMATS["ig-portrait"].width,
    height: CREATIVE_FORMATS["ig-portrait"].height,
  });
  assert.match(html, /\.sw-artboard\{width:1080px;height:1350px\}/);
  assert.match(html, /Design systems/);
  assert.doesNotMatch(html, /<script/i);
});
