// Recipe + resource node + craft station catalog — statická data z JSON, načtená
// jednou při startu modulu.

import type {
  CraftStationDefinition,
  Recipe,
  ResourceNodeDefinition,
} from 'irij-shared/types';

import recipesData from '../../data/recipes.json';
import resourceNodesData from '../../data/resource_nodes.json';
import craftStationsData from '../../data/craft_stations.json';

const RECIPE_CATALOG: { [recipeId: string]: Recipe } = {};
for (const r of recipesData as Recipe[]) {
  RECIPE_CATALOG[r.id] = r;
}

const RESOURCE_NODE_CATALOG: { [defId: string]: ResourceNodeDefinition } = {};
for (const n of resourceNodesData as unknown as ResourceNodeDefinition[]) {
  RESOURCE_NODE_CATALOG[n.id] = n;
}

const CRAFT_STATION_CATALOG: { [stationId: string]: CraftStationDefinition } = {};
for (const s of craftStationsData as CraftStationDefinition[]) {
  CRAFT_STATION_CATALOG[s.id] = s;
}

export function getRecipe(recipeId: string): Recipe | null {
  return RECIPE_CATALOG[recipeId] ?? null;
}

export function getAllRecipes(): Recipe[] {
  return Object.keys(RECIPE_CATALOG).map((id) => RECIPE_CATALOG[id]!);
}

export function getResourceNodeDef(defId: string): ResourceNodeDefinition | null {
  return RESOURCE_NODE_CATALOG[defId] ?? null;
}

export function getAllResourceNodeDefs(): ResourceNodeDefinition[] {
  return Object.keys(RESOURCE_NODE_CATALOG).map((id) => RESOURCE_NODE_CATALOG[id]!);
}

export function getCraftStationDef(stationId: string): CraftStationDefinition | null {
  return CRAFT_STATION_CATALOG[stationId] ?? null;
}

export function getAllCraftStations(): CraftStationDefinition[] {
  return Object.keys(CRAFT_STATION_CATALOG).map((id) => CRAFT_STATION_CATALOG[id]!);
}
