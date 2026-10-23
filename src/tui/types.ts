import type { RpcClient } from "@opencode/client"
import type { MultikeyRpc } from "../rpc"

export type MultikeyRpcClient = RpcClient<typeof MultikeyRpc>
