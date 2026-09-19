export type CatalogModel = { provider: string; model: string; label: string };

export type CatalogProviderGroup = {
  provider: string;
  label: string;
  models: CatalogModel[];
};

export function groupCatalogByProvider(
  catalog: CatalogModel[],
  providerLabels: Record<string, string> = {},
): CatalogProviderGroup[] {
  const groups: CatalogProviderGroup[] = [];
  const index = new Map<string, CatalogProviderGroup>();
  for (const entry of catalog) {
    let group = index.get(entry.provider);
    if (group === undefined) {
      const named = providerLabels[entry.provider];
      group = {
        provider: entry.provider,
        label: named && named.length > 0 ? named : entry.provider,
        models: [],
      };
      index.set(entry.provider, group);
      groups.push(group);
    }
    group.models.push(entry);
  }
  return groups;
}
