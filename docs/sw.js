// Service worker do Radar de Vagas: deixa a página abrir sem internet.
// Arquivos da página: usa o que está guardado e atualiza em segundo plano.
// vagas.json: tenta a rede primeiro (vagas do dia) e cai para a última cópia guardada.
// Chamadas a outros sites (Gemini, GitHub, fontes) nunca passam por aqui.

const VERSAO = "radar-v11"; // trocar junto com o ?v= do index.html
const ARQUIVOS = [
  "./", "index.html", "style.css?v=11", "app.js?v=11", "cv.js?v=11",
  "oh-tech-logo.png", "oh-tech-logo-claro.png", "oh-tech-icone.png", "icone-192.png", "icone-512.png", "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("/vagas.json")) {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put("vagas.json", copia)); return r; })
        .catch(() => caches.match("vagas.json")),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((guardado) => {
      const daRede = fetch(e.request)
        .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); } return r; })
        .catch(() => guardado);
      return guardado || daRede;
    }),
  );
});
