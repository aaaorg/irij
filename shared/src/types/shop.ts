// Shop / merchant types — viz docs/02e-data-model-ekonomika.md sekce 1.
//
// Phase 13: NPC obchody — pevné ceny, omezený stock, respawn proporcionálně,
// buy_limit_per_day. Specialist vs general store rozlišení v `type`.

// `general` = kupuje vše za ~50 % sell ceny (fallback).
// `specialist.<category>` = kupuje jen své kategorie za ~80-100 % + bonus.
export type MerchantTableType = 'general' | string; // string pro 'specialist.<category>' formy

export interface MerchantSellEntryDefinition {
  item_id: string;
  sell_price_denar: number;
  stock_max: number;
  // `respawn_per_hour` = kolik kusů přibyde za hodinu. Float OK
  // (např. 0.5 = 1 ks za 2 h). Server tick proporcionálně přepočítá.
  respawn_per_hour: number;
}

export interface MerchantBuyEntryDefinition {
  item_id: string;
  buy_price_denar: number;
  buy_limit_per_day: number;
}

// Static template z `merchant_tables.json`. Runtime stock + buy limity
// drží match state odděleně.
export interface MerchantTableDefinition {
  id: string;
  owner_npc_id: string;
  type: MerchantTableType;
  sell_items: MerchantSellEntryDefinition[];
  // Pokud je prázdné, NPC nekupuje nic. `general` typ obvykle má buy_items
  // implicitní (přijímá vše), ale MVP: pouze explicitní whitelist přes
  // `buy_items` — žádný "kupuje vše" magic.
  buy_items: MerchantBuyEntryDefinition[];
}

// Runtime instance per NPC obchod v match state. Stock je per-table,
// buy limity per-(table, item).
export interface MerchantTableState {
  table_id: string;
  // Kus na sklade per item_id. Decimální accumulator pro respawn_per_hour
  // přepočet při tick — uložen jako `_partial[item_id]`. Klient vidí jen
  // celočíselný `stock_current` (Math.floor).
  stock_current: { [itemId: string]: number };
  stock_partial: { [itemId: string]: number };
  // Daily buy limit consumed per item — reset 00:00 server time.
  buy_consumed_today: { [itemId: string]: number };
  // ISO date string (YYYY-MM-DD) v UTC, kdy bylo naposledy resetováno.
  // Při handleru porovnáme s aktuálním datem; pokud se liší, vyčistíme.
  buy_limit_reset_date: string;
  // Tick posledního stock respawn cycle — pro proporční přepočet.
  last_respawn_tick: number;
}
