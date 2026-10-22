// Testes de ponta a ponta: abrem o site (pasta docs) num navegador de verdade, com o Firebase simulado.
// Rodar: npm run test:e2e   (na primeira vez: npx playwright install chromium)
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:8790",
    // Fora do CI dá para usar o Chrome já instalado: PW_CANAL=chrome npm run test:e2e
    ...(process.env.PW_CANAL ? { channel: process.env.PW_CANAL } : {}),
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo", // datas de entrevista são horário de Brasília (o servidor do GitHub roda em UTC)
    acceptDownloads: true,
  },
  webServer: { command: "node test/e2e/servidor.mjs", url: "http://localhost:8790/index.html", reuseExistingServer: !process.env.CI },
});
