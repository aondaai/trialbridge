/**
 * The role-selection routing contract — the single source of truth for the
 * "choose your journey" entry screen (src/app/start/page.tsx). Kept as plain
 * data so the routing is unit-testable without rendering.
 */

export interface RoleOption {
  key: "sponsor" | "site";
  title: string;
  blurb: string;
  cta: string;
  href: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    key: "sponsor",
    title: "Sou Patrocinador",
    blurb:
      "Publique um protocolo e veja, por site e por região do Brasil, quantos pacientes elegíveis existem — com intervalo de confiança.",
    cta: "Rodar feasibility →",
    href: "/sponsor",
  },
  {
    key: "site",
    title: "Sou Site / Centro",
    blurb:
      "Cadastre seu centro e responda a protocolos com sua capacidade real — apenas contagens agregadas, nunca dados de paciente.",
    cta: "Listar meu site →",
    href: "/site",
  },
];
