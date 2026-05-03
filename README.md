# Irij

Browser MMORPG ve světě slovanského folklóru. Tick-based, 2D pixel art, Phaser klient + Nakama server.

## Quickstart

Předpoklady: Node 20+, pnpm 9+, Docker + Docker Compose.

```bash
# 1. Instalace závislostí
pnpm install

# 2. Spustit lokální Nakama + Postgres
pnpm infra:up

# 3. Build sdílených typů + serveru
pnpm build:shared
pnpm build:server

# 4. Spustit klient v dev modu
pnpm dev:client
```

Klient běží na `http://localhost:5173`, Nakama console na `http://localhost:7351` (admin/password).

## Struktura

```
irij/
├── client/          # Phaser klient (Vite + TypeScript)
├── server/          # Nakama TypeScript runtime modul
├── shared/          # Sdílené types, messages, constants
├── infra/           # Docker Compose, Nakama config
├── migrations/      # Postgres SQL migrations
├── tools/           # Build scripts, asset pipeline
└── docs/            # Designové dokumenty (00-04)
```

## Dokumentace

- [00 — Action plan](docs/00-action-plan.md) — checklist co dělat
- [01 — Scope & Pillars](docs/01-scope-and-pillars.md)
- [02a-e — Data model](docs/) — postava, itemy, svět, NPC/mobi/questy, ekonomika
- [03 — Message katalog](docs/03-message-katalog.md)
- [04 — Tech ADR](docs/04-tech-adr.md)
- [refs/skills.md](docs/refs/skills.md) — design dovedností a atributů

## License

TBD.
