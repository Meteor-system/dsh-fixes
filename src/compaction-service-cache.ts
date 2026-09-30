export function createAgentServiceCache<Agent extends object, Service extends object>(
  resolve: (agent: Agent) => Service | undefined,
): (agent: Agent) => Service | undefined {
  const services = new WeakMap<Agent, Service>();

  return (agent) => {
    const cached = services.get(agent);
    if (cached !== undefined) return cached;

    const service = resolve(agent);
    if (service !== undefined) services.set(agent, service);
    return service;
  };
}
