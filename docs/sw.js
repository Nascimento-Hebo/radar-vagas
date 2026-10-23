// Service worker do Radar de Vagas: deixa a página abrir sem internet.
// Arquivos da página: usa o que está guardado e atualiza em segundo plano.
// vagas.json: tenta a rede primeiro (vagas do dia) e cai para a última cópia guardada.
// Chamadas a outros sites (Gemini, GitHub, fontes) nunca passam por aqui.

const VERSAO = "radar-v26"; // trocar junto com o ?v= do index.html
const ARQUIVOS = [
  "./", "index.html", "login.html", "termos.html", "privacidade.html", "extensao.html", "style.css?v=26", "app.js?v=26", "cv.js?v=26", "cv-ferramentas.js?v=26", "email.js?v=26", "mercado.js?v=26", "evoluir.js?v=26", "push.js?v=26", "perguntas.js?v=26", "onboarding.js?v=26", "suporte.js?v=26", "avatares.js?v=26", "firebase.js?v=26",
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

// Notificação das vagas novas (mandada pelo robô diário, scripts/alertas.mjs)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Radar de Vagas", {
    body: d.corpo || "Chegaram vagas novas para você.",
    icon: "icone-192.png",
    badge: "icone-192.png",
    tag: d.tag || "vagas-novas",
    data: { url: d.url || "./" },
  }));
});

// Clique na notificação: volta para a aba do Radar (ou abre uma)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abas) => {
    const aba = abas.find((c) => c.url.startsWith(self.registration.scope));
    if (aba) { aba.navigate(alvo).catch(() => {}); return aba.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
