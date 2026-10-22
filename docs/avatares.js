// Avatares prontos para o assistente de suporte (o super admin escolhe um ou envia uma imagem no painel).
// São SVGs pequenos guardados como data URL, então não dependem de nenhum arquivo nem servidor.
(function () {
  const svg = (corpo) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${corpo}</svg>`);
  window.AVATARES = [
    {
      id: "robo",
      nome: "Robô Radar",
      src: svg(`<rect width="96" height="96" rx="48" fill="#6ea1ff"/><line x1="48" y1="14" x2="48" y2="26" stroke="#0f1b3d" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="12" r="6" fill="#f5a623"/><rect x="20" y="26" width="56" height="44" rx="16" fill="#fff"/><circle cx="37" cy="46" r="7" fill="#0f1b3d"/><circle cx="59" cy="46" r="7" fill="#0f1b3d"/><circle cx="39" cy="44" r="2.2" fill="#fff"/><circle cx="61" cy="44" r="2.2" fill="#fff"/><path d="M38 59q10 7 20 0" stroke="#0f1b3d" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="12" y="40" width="8" height="14" rx="4" fill="#fff"/><rect x="76" y="40" width="8" height="14" rx="4" fill="#fff"/><path d="M30 70h36v10a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z" fill="#0f1b3d"/>`),
    },
    {
      id: "atendente",
      nome: "Atendente",
      src: svg(`<rect width="96" height="96" rx="48" fill="#0f1b3d"/><circle cx="48" cy="40" r="18" fill="#f2c9a0"/><path d="M30 36a18 18 0 0 1 36 0v4h-4v-4a14 14 0 0 0-28 0v4h-4z" fill="#3b2a20"/><path d="M26 40a22 22 0 0 1 44 0" stroke="#6ea1ff" stroke-width="5" fill="none"/><rect x="22" y="38" width="8" height="14" rx="4" fill="#6ea1ff"/><rect x="66" y="38" width="8" height="14" rx="4" fill="#6ea1ff"/><path d="M70 50q0 10-12 12" stroke="#6ea1ff" stroke-width="3" fill="none"/><circle cx="57" cy="62" r="3" fill="#f5a623"/><circle cx="42" cy="40" r="2" fill="#0f1b3d"/><circle cx="54" cy="40" r="2" fill="#0f1b3d"/><path d="M43 47q5 4 10 0" stroke="#0f1b3d" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M20 92a28 22 0 0 1 56 0z" fill="#6ea1ff"/>`),
    },
    {
      id: "oh",
      nome: "OH Tech",
      src: svg(`<rect width="96" height="96" rx="48" fill="#0a0f1d"/><circle cx="48" cy="48" r="32" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="170 32" transform="rotate(-60 48 48)"/><circle cx="72" cy="22" r="7" fill="#f5a623"/><circle cx="36" cy="34" r="7" fill="#6ea1ff"/><circle cx="60" cy="34" r="7" fill="#6ea1ff"/><rect x="31" y="44" width="10" height="26" rx="5" fill="#6ea1ff"/><rect x="55" y="44" width="10" height="26" rx="5" fill="#6ea1ff"/><rect x="34" y="52" width="28" height="9" fill="#6ea1ff"/>`),
    },
    {
      id: "balao",
      nome: "Balão de conversa",
      src: svg(`<rect width="96" height="96" rx="48" fill="#3ddc97"/><path d="M22 30a10 10 0 0 1 10-10h32a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H42l-14 12V64h4a10 10 0 0 1-10-10z" fill="#fff"/><circle cx="36" cy="42" r="4.5" fill="#0f1b3d"/><circle cx="48" cy="42" r="4.5" fill="#0f1b3d"/><circle cx="60" cy="42" r="4.5" fill="#0f1b3d"/>`),
    },
    {
      id: "foguete",
      nome: "Foguete",
      src: svg(`<rect width="96" height="96" rx="48" fill="#f5a623"/><path d="M48 14c14 10 18 26 14 44H34c-4-18 0-34 14-44z" fill="#fff"/><circle cx="48" cy="38" r="7" fill="#6ea1ff" stroke="#0f1b3d" stroke-width="3"/><path d="M34 50l-10 12 12-2zM62 50l10 12-12-2z" fill="#0f1b3d"/><path d="M40 60h16l-3 12-5 8-5-8z" fill="#e8461f"/>`),
    },
  ];
  window.avatarPadrao = () => window.AVATARES[0].src;
})();
