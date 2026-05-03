# 02c — Data model: Svět

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat strukturu mapy, zón, dlaždic, budov a interiérů.
**Sourozenci:** 02a Postava, 02b Itemy, 02d NPC/Mobi/Questy, 02e Ekonomika.

---

## Reprezentace světa

### Tile-based grid

- **Souřadnice:** celočíselné `(x, y)`, `i32`. Žádný continuous movement, žádný subpixel.
- **Origin** (0, 0) = severozápadní roh světa. X roste na východ, Y roste na jih (image-coord convention, pasuje k Phaser).
- **Dlaždice:** **48 × 48 px** (rozhodnutí 2026-05-01).
- Pohyb hráče = 1 dlaždice (cardinal nebo diagonal) / movement step. Pohyb je **8-směrový** (4 cardinal + 4 diagonal) — viz [ADR-020](04-tech-adr.md#adr-020-8-směrový-pohyb-octile-a). Pohyb po dlaždicích je diskrétní (interpolace na klientovi pro plynulost), broadcast je path-based 1× per MOVE_REQUEST acceptance (ADR-019), ne 10 Hz tile-by-tile.

### Otevřený svět vs. zóny

**Otevřený svět** (rozhodnutí 2026-05-01). Fyzicky jedna velká mapa, logicky rozdělená do "regionů" (Blatiny, Bažina Černav, Hvozd Tichoušek...) jen pro UI / ambient music / mob population. Phaser 3 to zvládá nativně přes Tilemap.

**Technicky proveditelné:** ano. Pro MVP zóna 256×256 = 65 536 dlaždic = jediný Phaser Tilemap, žádný chunking nutný. Pro post-MVP (svět 2048×2048+) přijde **chunk streaming pattern** (server posílá jen viditelné chunky 64×64 dlaždic + okolí).

### MVP scope mapy

- **Velikost: 256 × 256 dlaždic** (~12 288 × 12 288 px renderable plocha)
- **Hustota:** vesnice Blatiny + 5 okolních biome regionů, každý ~50×50 dlaždic
- **Žádné loading screens** uvnitř MVP mapy

### Scaling roadmap (kritické pro architekturu)

Cíl: rozšíření na **desítky tisíc dlaždic** v každém směru (RSC-velikost je ~12 800×12 800, AAA MMO běžně 30 000+).

**256×256 → 1000×1000:** stále jeden Phaser Tilemap, žádná změna architektury. Hraniční s Phaser perf, ale použitelné.

**1000×1000 → 50 000×50 000:** **chunk streaming je povinný.** Architekturní rozhodnutí, která musí být **zabudovaná od začátku, i když je v MVP nepoužíváme**:

1. **Coordinate system:** už je `i32`, scaling-friendly. ✓
2. **Chunk granularita:** **64×64 dlaždic per chunk** (vyzkoušený standard). Pro 50k×50k mapu to je ~610 000 chunks.
3. **Server spatial indexing:** match handler udržuje hráče seskupené **po chunkach**, ne per-zone. Spatial queries ("kdo je v dosahu mého hráče") = lookup do 9 chunks (current + 8 sousedních), ne globální scan.
4. **Klient streaming:** klient drží načtené **3×3 chunky** kolem hráče (192×192 dlaždic). Když překročí hranici → načti nové chunky, uvolni vzdálené.
5. **Map data storage:** každý chunk = samostatný JSON / binární soubor, načítaný on-demand. Pro server je to OK přímo z disku, klient to fetchuje přes HTTP/WebSocket.
6. **Mob/resource spawn registry:** indexovaný **per chunk**, ne globálně. Mob v chunku 17,42 nikdy netiká pokud žádný hráč není v okolí (sleeping chunks).
7. **Subscription scope:** Nakama match je single match handler pro celý svět by neškáloval. Scaling pattern: **match handler per chunk-cluster** (např. 16×16 chunkov = jeden handler), s cross-handler proxy pro hraniční interakce. Detail v ADR.

**Co MVP udělá pro tuhle roadmap, ale se vyhne komplexitě:**
- Mapa fyzicky 256×256, ale **uložená a načítaná po chunkách 64×64** (16 chunkov pro MVP)
- Server spatial index per chunk implementovaný i když má 16 chunkov
- Klient drží všechny chunky najednou (žádné streaming UI work) — když rozšíříme, jen zapneme streaming mód

Tím získáš škálovací cestu **bez narušení MVP timing** (~1 týden navíc na chunkové loading patterny).

> **Architekturní commit:** žádný kód nesmí předpokládat "celá mapa je v paměti" nebo "celá mapa je jeden tilemap". Toto pravidlo se vynucuje code review.

---

## Layers mapy

Hierarchie z dolu nahoru (render order):

| Layer        | Kód                | Kolize | Obsah                                                                    |
| ------------ | ------------------ | ------ | ------------------------------------------------------------------------ |
| Terrain      | `layer.terrain`    | ne     | Tráva, písek, kámen, voda — base ground.                                 |
| Walkable mod | `layer.walkable`   | meta   | Logická maska "walkable / non-walkable" pro pathfinding (per-tile bool). |
| Objects      | `layer.objects`    | ano    | Stromy, kameny, ploty, budovy (vnější stěny). Každá dlaždice 1 object.   |
| Entities     | `layer.entities`   | dyn    | Hráči, NPC, mobi, droppy. Dynamická vrstva.                              |
| Decoration   | `layer.decoration` | ne     | Květiny, kameny v trávě, drobnosti — flavor.                             |
| Roof         | `layer.roof`       | ne     | Střechy budov. Skryje se, když hráč vejde dovnitř (proximity check).     |
| FX overlay   | `layer.fx`         | ne     | Particle, mlha v Bažině, ambient lighting. Statický mood, ne cyklus.     |

### Walkable mask

Per-tile bool. Server používá pro **pathfinding** (A*) i **movement validaci** (klient řekne "jdu na X" → server zkontroluje, že cesta vede přes walkable). Generuje se z combined kolizí terrain + objects + budovy.

### Tile metadata

Některé dlaždice mají statickou metadata (než je object) — např. "tato voda je rybařitelná", "tento kámen je tier 2 mining". Reprezentace:

```jsonc
{
  "tile_meta": {
    "12,45": { "resource": "fish_spot", "tier": 1 },
    "78,99": { "resource": "ore_node", "tier": 2, "ore_type": "iron" },
    "200,134": { "transition_to": "instance.temple_blatiny", "trigger": "step_on" }
  }
}
```

Ukládáno spolu s mapou, načítáno při startu match handleru.

---

## Interiéry — duální přístup

| Typ stavby                          | Strategie                                                          |
| ----------------------------------- | ------------------------------------------------------------------ |
| **Malé budovy (dům, krám, kovárna)** | **In-place, roof toggle.** Hráč vejde dveřmi → server odebere `roof` layer pro tuto budovu, hráč pokračuje na hlavní mapě. (rozhodnutí 2026-05-01) |
| **Velké struktury (chrám, hospoda víceposchoďová, dungeon)** | **Separátní instance** s vlastní mapou. Vstup = teleport (transition trigger). |

### Roof toggle mechanika

Každá budova má svůj **building footprint** (množina dlaždic, které tvoří střechu). Server trackuje "kdo je uvnitř které budovy" podle pozice hráče. Když hráč vejde:
1. Server pošle event `enter_building(building_id)` → klient skryje roof tiles té budovy
2. Když opustí → `exit_building` → klient roof obnoví

Pro ostatní hráče _venku_ je roof viditelný, takže nevidí dovnitř (privacy + immersion).

### Instance entities

Velké interiéry / dungeons jsou samostatné mapy s vlastním `instance_id`. Návrat na hlavní mapu = teleport zpět na "exit position". Instance může být:
- **Shared** — jeden chrám pro všechny hráče (typický)
- **Per-party** — dungeon, kde má každá parta vlastní instanci (post-MVP)

### Entita: `WorldInstance`

```jsonc
{
  "id": "instance.temple_blatiny",
  "name_cs": "Chrám v Blatinách",
  "type": "shared",
  "map_data_ref": "maps/instance_temple_blatiny.json",
  "size_tiles": [40, 40],
  "exit_to": { "zone": "world_main", "position": [128, 142] }
}
```

---

## MVP zóna: Blatiny + okolí

Obsah pro vertikální slice MVP. Konkrétní layout zón v rámci 256×256 mapy:

| Region              | Velikost       | Biome           | Obsah                                                      |
| ------------------- | -------------- | --------------- | ---------------------------------------------------------- |
| **Blatiny**         | ~50×50         | vesnice         | Kovárna, hospoda, krejčovství, alchymista, truhlář, chrám (instance), domy NPC, banka (truhla v hospodě), tržiště |
| **Hvozd Tichoušek** | ~70×70         | les             | Stromy (woodcutting), nízkoúrovňoví mobové, byliny         |
| **Kamenolom**       | ~30×30         | rocky           | Mining nodes T1-T2, několik mobů                           |
| **Řeka Bystřinka**  | ~80×8 (úzký pruh) | sladkovodní | Fishing spots T1-T2                                        |
| **Bažina Černav**   | ~60×60         | mokřad          | Vodník (mob), Hastrman (mob), bažinné byliny, **trvale mlha** v FX layeru, šerá atmosféra |
| **Lovecké pláně**   | ~40×40         | louka           | Jeleni, zajíci, lišky (Hunting skill, kožky)               |

Zbytek mapy = neutral terén (cesty, neudržované louky, ne-rušivé okolí). Post-MVP rozšíříme.

### Ambient stylizace per region

Místo dynamického den/noc cyklu (viz níže) každý region nese **statický mood** přes FX layer:
- **Blatiny:** denní, teplé světlo, žádný overlay
- **Bažina Černav:** trvale mlha, modrošedý tint, šerá nálada — cítíš to i v poledne
- **Hvozd Tichoušek (hlubina):** mírný stinný overlay (zelenkavý), tlumený zvuk
- **Lovecké pláně:** otevřené denní světlo, jasné

> Tohle dává slovansko-folklórní atmosféru _bez_ technické zátěže cyklu.

---

## Den / noc cyklus — DOPORUČENÍ: vynechat z MVP

Na základě tvé otázky "k čemu tam bude" — **doporučuju cyklus _nedělat_ v MVP**.

**Proč ne:**
- Technicky netriviální: lighting overlay, sprite varianty pro noc, NPC schedules, jiné mob spawny
- Casual goal: hráč nemá být tlačen do "musím být online v noci kvůli X"
- Slovanský mood lze docílit **statickou regionální stylizací** (viz výše) — Bažina je _trvale_ ponurá, Hvozd Tichoušek _trvale_ stinný
- Pokud později chceš noční mob (Polednice spí přes den) → vyřeší to **scheduled spawn timer**, ne cyklus (viz níže)

**Co _ano_ v MVP:**
- **Statická regionální stylizace** (FX overlay per region)
- **Scheduled spawn timery** pro vzácné moby (např. Polednice respawnuje v Bažině 1× za 4-8 hodin reálného času)
- **Resource respawn timery** (mining node 5-30 min, herb 2-15 min, fish spot vždy aktivní)

**Post-MVP (parking lot):**
- Skutečný den/noc cyklus s lighting
- NPC schedules (kovář v noci spí)
- Počasí (déšť, sníh, vichr)

---

## Resource a mob spawn timery

Místo cyklu řídíme svět **per-entity respawn timery** v match state.

### Entita: `ResourceNode` (statická definice + dynamický stav)

```jsonc
{
  "id": "node.iron_kamenolom_001",
  "type": "ore_node",
  "tier": 2,
  "ore_type": "iron",
  "position": [78, 99],
  "respawn_min_s": 300,                // 5 min
  "respawn_max_s": 600,                // 10 min
  "current_state": "available"         // available | depleted
}
```

Když hráč vytěží node:
1. Server kontroluje `tool_required` + skill level
2. Award itemy + XP, set `current_state: depleted`, schedule respawn
3. Po respawn timeru → `current_state: available`

### Entita: `MobSpawn`

```jsonc
{
  "id": "spawn.wolf_hvozd_007",
  "mob_id": "mob.wolf",
  "spawn_position": [102, 215],
  "leash_radius_tiles": 15,            // jak daleko se mob vzdálí od spawn pointu
  "respawn_min_s": 60,
  "respawn_max_s": 180,
  "scheduled": null                    // pro vzácné moby
}
```

### Scheduled rare mobs

Pro vzácné moby (Polednice, Vlkodlak) `scheduled` pole:

```jsonc
{
  "scheduled": {
    "interval_min_s": 14400,           // 4 hodiny
    "interval_max_s": 28800,           // 8 hodin
    "broadcast_on_spawn": true         // pošli system message hráčům v zóně
  }
}
```

Když Polednice spawne, všichni hráči v Bažině dostanou zprávu "Polednice se zjevila u rybníka". Vznikají organické "events" bez nutnosti cyklu.

> Mobové detail v 02d.

---

## Player housing — parking lot

Rozhodnutí 2026-05-01: **odsunuto post-MVP.**

Když to budeme řešit, zvážíme:
- Kde mohou domy stát (vyhrazené stavební dlaždice s "buildable: true" metadata)
- Kdo je vlastníkem (1 hráč / guild)
- Jak se získává (questy, koupě, "obsazení neobsazené parcely")
- Co je uvnitř (skladovací truhla, pec, postel pro logout bonus...)
- Dispozice při neaktivitě (NPC zruší pronájem po 30 dnech offline?)
- Vizuální reprezentace na mapě (jméno vlastníka nad střechou)

> **Prozatím v `tile_meta`** flagujeme "future buildable" plochy v Blatinách, ať si nezablokujeme možnost.

---

## Constraints / invariants

1. **Pohyb:** server vždy validuje cestu **8-směrovým A*** (cardinal + diagonal, octile cost, no-corner-cutting — viz [ADR-020](04-tech-adr.md#adr-020-8-směrový-pohyb-octile-a)) na walkable mask. Klient nikdy nedefinuje vlastní cestu autoritativně.
2. **Speed cap:** `tiles_per_second` per hráč max ~3 (provisional). Step je atomický — cardinal i diagonal zabírá stejný čas 1/speed_tps. Server odmítá pohyb rychlejší.
3. **Kolize:** dvě entity (hráč/mob/NPC) nemohou stát na stejné dlaždici současně — výjimka loot drop a effect items.
4. **Resource gating:** vytěžit node = `tool_tier ≥ node_tier` AND `skill_level ≥ tier_required`.
5. **Instance entry:** vstup do `WorldInstance` validovaný (questovka, level gate, party check).
6. **Roof toggle:** server určuje, kdo je v které budově, klient _nikdy_ nesmí vlastním rozhodnutím skrýt cizí roof.
7. **Building footprint:** statický seznam dlaždic per budova, nelze měnit za běhu (housing post-MVP změní).

---

## Open questions / parking lot

- [ ] Konkrétní layout MVP mapy — vyrobí se v Tiled nebo podobném editoru po MVP design lock.
- [ ] Player housing — celý subsystém parking lot.
- [ ] Den/noc cyklus — parking, post-MVP rozhodnutí jestli vůbec.
- [ ] Počasí — parking.
- [ ] Mount/cart movement (rychlejší pohyb, větší capacity) — parking.
- [ ] World events — globální spouštěné eventy (invaze, festival) — parking.
- [ ] Fast travel — runy přesunu, lodě, brány — parking, post-MVP.
- [ ] Weather-locked resources (nějaké byliny rostou jen za deště) — parking, závisí na počasí.

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených rozhodnutí. Přidán region Bažina Černav. Den/noc cyklus parkován ve prospěch statické regionální atmosféry + scheduled spawn timerů.
- **2026-05-01** — Draft 1.1: přidán **Scaling roadmap** kvůli cílové velikosti světa (desítky tisíc tiles). Chunk-based architektura zabudovaná od MVP (16 chunků 64×64 dlaždic), klient zatím bez streamingu — připraveno na rozšíření bez refaktoringu. Movement speed cap 3 tiles/s lock. Special mob spawn = regional broadcast lock.
