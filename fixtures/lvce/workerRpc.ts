import { ModuleWorkerWithMessagePortRpcParent, PlainMessagePortRpc, type Rpc } from '@lvce-editor/rpc'

export const launchWorker = async (name: string, url: string, commandMap: Record<string, (...args: any[]) => unknown>): Promise<Rpc> => {
  const { port1, port2 } = new MessageChannel()
  await ModuleWorkerWithMessagePortRpcParent.create({
    commandMap: {},
    name,
    port: port1,
    url,
  })
  return PlainMessagePortRpc.create({
    commandMap,
    messagePort: port2,
  })
}
