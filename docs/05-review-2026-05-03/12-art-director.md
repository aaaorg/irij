# Art Director Review

**Reviewer role:** Art Director / Pixel Art Lead (Tibia, Stardew, Habbo iso pipeline experience)
**Datum:** 2026-05-03
**Scope:** vizuální stack, asset pipeline, sprite plán, slovanský moodboard, IP risk

## TL;DR

Engineering kontrakt iso 2:1 (ADR-018) je správný a pro slovanský folklór ideální — dřevo, došky, valbové střechy a multi-height stavby z toho profitují. **Největší riziko není technika, ale art direction:** projekt nemá style guide, žádný moodboard, license-mix mezi `Isometric_tileset.zip` (Ancient Tiles V1, restriktivní) a CC0 Kenney je nevyřešený, a 8-směrový sprite plán per ADR-020 je nereálný pro sólo-dev bez external pipeline. Doporučuji: 1) okamžitě napsat 05 Style Guide (1 stránka, paleta + reference grid + angle lock), 2) committed na **PixelLab + Aseprite** stack jako primární char/asset pipeline, 3) přepnout na Kenney Isometric (CC0) + custom Slavic overlay pro Phase 18, 4) pro MVP dropnout 8 směrů → 4 hlavní iso směry (NE/NW/SE/SW) — 50 % asset úspora, vizuální parita s Tibií. Slovanský folklór (Aleš/Lada) potřebuje konkretizaci do referenčního boardu — ne abstraktní "atmosféra", ale 20-30 pinů (dřevěnice, perníkové štíty, slámové došky, polednice v bílém, Baba Jaga chýše na kuří noze).

## Úspěchy / co stojí

1. **ADR-018 lock je čistý** — 64×32 footprint, 2:1 dimetric, projection util oddělený od tilemap je textbook a nebudeš to přepisovat.
2. **Logický grid ortogonální / render iso oddělený** — server zůstane jednoduchý, asset team nemusí rozumět math; tohle je přesně co dělají Habbo a Tibia.
3. **Layered sprite design v `Appearance`** (skin → outfit → equipment → hair → helmet) je správný — paper-doll system za pár hodin, equipment dropy "for free" později.
4. **`Isometric_tileset.zip` (Ancient Tiles V1)** v repu je solidní starting point pro architekturu — castles, walls, stairs, roofs už hotové, 222 tilů, 2:1 projekce.
5. **Phase 4c MVP statický `FRAME_FACING_SE`** je správný triáž — neblokuje movement test a animaci dotáhneš v Phase 18.

## Rizika / mezery

1. **[P0] License konflikt v `Isometric_tileset.zip`** — License.txt říká „nepoužívat na AI training data" + nevyjasněný redistribute. Pokud commitneš PNG do public Git repa, distribuuješ je. **Buď vykop autora a doplň licenci, nebo nahraď za Kenney CC0 do týdne.** Nejde to ignorovat do Phase 18.
2. **[P0] Žádný style guide / moodboard** — `docs/05` v action planu je „začni psát parallelně s polish". To je pozdě. Bez guide bude Scenario/PixelLab gen vyrábět 5 různých estetik a strávíš víc času cleanupem než kdybys měl 1-stránkový lock předem (paleta hex codes, reference angle, light direction, line weight).
3. **[P1] 8-směrový sprite plán je nereálný pro sólo dev** — postava: 8 dirs × (4 idle + 8 walk + 6 attack) × 3 outfit × 4 hair × 3 skin layers = ~6900 frames per char-template. I s PixelLab a layered comp jsi na 80-120 hod jen pro hráče. **MVP doporučení: 4 dirs (NE/NW/SE/SW), idle 1 frame + walk 4 frames** = 20 frames per layer. 8 dirs si nech na post-MVP.
4. **[P1] Slovanský folklór = nedefinovaný brief** — "Aleš/Lada" je atmosféra, ne reference. Pro AI gen potřebuješ konkrétní visual nouns: dřevěné sruby s vyřezávaným štítem, slaměné/šindelové došky, perníkové domky se zdobenými okny, kapličky s onion-dome, oltáře v lese (pohanské idoly, vlčí lebky), polednice v bílém lněném plátně, Baba Jaga chýše na kuří noze. Bez toho dostaneš generic-fantasy-village.
5. **[P1] Tileset count odhad pro 256×256 Blatiny** je ~150-200 unique tilů (terrain 30 + water/shore 20 + path 10 + buildings 60 + roofs 20 + props 40 + decals 20). Kenney + custom slavic overlay pokryje 70 %, zbytek custom v PixelLab. **30-50 hod art práce, ne `+20 % polish overhead`.**
6. **[P2] Audio pipeline v Phase 18** je underspec — ElevenLabs není dobrý pro ambient (lepší freesound CC0 + manual master); SFX pixel-art games dělají v sfxr/Bfxr (free) nebo Chiptone, ne ElevenLabs. Updatuj ADR-014.

## Doporučené akce

1. **Tento týden:** napiš `docs/05-style-guide.md` (1 stránka): paleta (16-32 hex codes — tlumená země / mech / dřevo / pochodňové žluté / večerní modrá / polednice bílá), 30° iso angle reference image, light direction (top-left konvence Tibia/Stardew), line weight (1px, no AA), pixel density (no sub-pixel detail).
2. **Resolve license:** otevři Isometric_tileset.zip License.txt issue — buď zaplať/dohni autora pro explicit redistribute permission, nebo přepni na Kenney Isometric Buildings + Isometric Landscape (CC0, 256 assets total) jako baseline.
3. **Sprint na moodboard:** vytvoř `docs/refs/moodboard/` s 30 piny — slovanské skanzeny (Strážnice, Rožnov), Aleš/Lada knižní ilustrace screenshoty, Tibia village screenshots, Stardew warmth references, polednice/Baba Jaga concept art. Toto bude prompt-context pro každou AI gen session.
4. **Pipeline lock:** PixelLab Aseprite plugin jako primární char tool (8/4-direction rotace + skeleton anim z 1 reference); Scenario jen pro tilesets/props (style transfer z moodboardu). Manuální cleanup v Aseprite vždy povinný — nikdy raw AI output do `client/public/sprites/`.
5. **Reduce 8 → 4 sprite směrů pro celý MVP** — ADR-020 už dnes říká 4 jako minimum. Updatuj ADR-018 sekci 7 explicitně: "MVP = 4 iso směry (NE/NW/SE/SW), 8 směrů je post-MVP polish target". Cardinal pohyby (N/S/E/W) v 8-conn pathfindingu se mapují na nejbližší diagonal facing — vizuálně 95 % parita s Tibií, 50 % asset úspora.
6. **Audio rethink:** updatuj ADR-014 — SFX přes Bfxr/Chiptone (free, instant, pixel-art-native), ambient přes Freesound CC-BY (3-5 stem layerů: les / vesnice / krčma), music post-MVP. ElevenLabs jen pro NPC voice barks pokud se vůbec udělá (v MVP přeskočit).

## Reference

- [Kenney Isometric Buildings (CC0, 128 assets)](https://kenney.nl/assets/isometric-tiles-buildings)
- [Kenney Isometric Landscape (CC0)](https://kenney.nl/assets/isometric-landscape)
- [PixelLab AI](https://www.pixellab.ai/) — 4/8-direction rotation, Aseprite plugin, style-consistent editing
- [Aseprite](https://www.aseprite.org/) — industry-standard pixel art tool ($20)
- [Bfxr](https://www.bfxr.net/) / [Chiptone](https://sfbgames.itch.io/chiptone) — pixel-game SFX
- [Freesound.org](https://freesound.org/) — CC-BY ambient stems
- Slovanské skanzeny: Wallachian Open Air Museum (Rožnov), Strážnice, Wdzydze (PL)
- Aleš (Mikoláš), Lada (Josef) — knižní ilustrace 19. st. českého folklóru
- Tibia art evolution 2008→2024 (CipSoft redesign) — case study v zachování retro feelu při HD upscale
- Stardew Valley GDC 2017 — ConcernedApe pixel art workflow talk
