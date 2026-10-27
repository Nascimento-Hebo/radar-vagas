// Testes de ponta a ponta com o Firebase de verdade, no emulador (login e banco), sem tocar o projeto real.
// Rodar: npm run test:emulador (sobe os emuladores de Auth e Firestore e roda test/emulador)
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({ ...base, testDir: "test/emulador", retries: 0 });
