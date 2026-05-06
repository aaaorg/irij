import { describe, expect, it } from 'vitest';

import { parseCraftRequest } from './crafting.js';
import { getAllRecipes, getAllCraftStations, getRecipe } from '../lib/recipes.js';
import { getItemDef } from '../lib/items.js';

describe('parseCraftRequest', () => {
  it('accepts valid payload', () => {
    const r = parseCraftRequest({ recipe_id: 'recipe.whetstone.t1', quantity: 5 });
    expect(r).not.toBeNull();
    expect(r?.quantity).toBe(5);
  });

  it('rejects quantity below 1', () => {
    expect(parseCraftRequest({ recipe_id: 'recipe.whetstone.t1', quantity: 0 })).toBeNull();
  });

  it('rejects quantity above batch cap', () => {
    expect(parseCraftRequest({ recipe_id: 'recipe.whetstone.t1', quantity: 999 })).toBeNull();
  });

  it('rejects missing recipe_id', () => {
    expect(parseCraftRequest({ quantity: 1 })).toBeNull();
  });

  it('rejects non-int quantity', () => {
    expect(parseCraftRequest({ recipe_id: 'recipe.whetstone.t1', quantity: 1.5 })).toBeNull();
  });
});

describe('Recipe catalog', () => {
  it('has at least 3 recipes', () => {
    expect(getAllRecipes().length).toBeGreaterThanOrEqual(3);
  });

  it('every recipe has resolvable inputs and output', () => {
    for (const r of getAllRecipes()) {
      expect(getItemDef(r.output.item_id)).not.toBeNull();
      if (r.inputs) {
        for (const inp of r.inputs) {
          expect(getItemDef(inp.item_id)).not.toBeNull();
        }
      }
      expect(r.crafting_time_ms).toBeGreaterThan(0);
      expect(r.primary_skill.level).toBeGreaterThanOrEqual(1);
    }
  });

  it('whetstone recipe consumes flint', () => {
    const r = getRecipe('recipe.whetstone.t1');
    expect(r?.inputs?.[0]?.item_id).toBe('material.stone.flint');
    expect(r?.output.item_id).toBe('consumable.whetstone.t1');
    expect(r?.station_required).toBe('smith_forge');
  });

  it('returns null for unknown recipe', () => {
    expect(getRecipe('recipe.fake')).toBeNull();
  });
});

describe('Craft station catalog', () => {
  it('has at least one smith_forge', () => {
    const all = getAllCraftStations();
    const smith = all.filter((s) => s.station_type === 'smith_forge');
    expect(smith.length).toBeGreaterThanOrEqual(1);
  });

  it('all stations have valid positions', () => {
    for (const s of getAllCraftStations()) {
      expect(s.position.x).toBeGreaterThanOrEqual(0);
      expect(s.position.y).toBeGreaterThanOrEqual(0);
    }
  });
});
