export type CompactionRehydrationGate = {
  claim(agent: object, compactionKey: string): boolean;
  release(agent: object, compactionKey: string): void;
};

export function createCompactionRehydrationGate(): CompactionRehydrationGate {
  const claims = new WeakMap<object, Set<string>>();

  return {
    claim(agent, compactionKey) {
      const agentClaims = claims.get(agent) ?? new Set<string>();
      if (agentClaims.has(compactionKey)) return false;
      agentClaims.add(compactionKey);
      claims.set(agent, agentClaims);
      return true;
    },
    release(agent, compactionKey) {
      const agentClaims = claims.get(agent);
      if (agentClaims === undefined) return;
      agentClaims.delete(compactionKey);
      if (agentClaims.size === 0) claims.delete(agent);
    },
  };
}
