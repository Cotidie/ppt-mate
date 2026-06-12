// Rewrites deck.json from the old plain-string shape to the rich-text Span[]
// shape. Idempotent: safe to run more than once.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrateDeck } from "../src/model/migrate";

const here = dirname(fileURLToPath(import.meta.url));
const deckPath = resolve(here, "..", "deck.json");
const deck = JSON.parse(readFileSync(deckPath, "utf8"));
const migrated = migrateDeck(deck);
writeFileSync(deckPath, JSON.stringify(migrated, null, 2) + "\n", "utf8");
console.log("migrated", deckPath);
