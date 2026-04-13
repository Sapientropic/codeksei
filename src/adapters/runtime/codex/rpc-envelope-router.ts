export type RpcMessageListener = (message: unknown) => void;

export interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface RpcEnvelopeRouter {
  readonly messageListeners: Set<RpcMessageListener>;
  readonly pending: Map<string, PendingEntry>;
  onMessage(listener: RpcMessageListener): () => boolean;
  sendRequest(method: string, params: unknown): Promise<unknown>;
  sendNotification(method: string, params: unknown): Promise<void>;
  sendResponse(id: unknown, result: unknown): Promise<void>;
  handleIncoming(rawMessage: string): void;
  rejectPending(error: Error): void;
}

export function createRpcEnvelopeRouter({
  sendRaw,
}: {
  sendRaw(payload: string): void;
}): RpcEnvelopeRouter {
  const messageListeners = new Set<RpcMessageListener>();
  const pending = new Map<string, PendingEntry>();

  return {
    messageListeners,
    pending,
    onMessage(listener: RpcMessageListener): () => boolean {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    async sendRequest(method: string, params: unknown): Promise<unknown> {
      const id = createRpcRequestId();
      const payload = JSON.stringify({ id, method, params });
      const responsePromise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      try {
        sendRaw(payload);
      } catch (error) {
        pending.delete(id);
        throw error;
      }
      return responsePromise;
    },
    async sendNotification(method: string, params: unknown): Promise<void> {
      sendRaw(JSON.stringify({ method, params }));
    },
    async sendResponse(id: unknown, result: unknown): Promise<void> {
      if (id == null || id === "") {
        throw new Error("Codex RPC response requires a non-empty id");
      }
      sendRaw(JSON.stringify({ id, result }));
    },
    handleIncoming(rawMessage: string): void {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawMessage);
      } catch {
        return;
      }

      const envelope = asRecord(parsed);
      if (envelope.id != null && pending.has(String(envelope.id))) {
        const entry = pending.get(String(envelope.id));
        pending.delete(String(envelope.id));
        if (!entry) {
          return;
        }
        const errorPayload = asRecord(envelope.error);
        if (Object.keys(errorPayload).length) {
          entry.reject(new Error(String(errorPayload.message || "Codex RPC request failed")));
          return;
        }
        entry.resolve(parsed);
        return;
      }

      for (const listener of messageListeners) {
        listener(parsed);
      }
    },
    rejectPending(error: Error): void {
      for (const { reject } of pending.values()) {
        reject(error);
      }
      pending.clear();
    },
  };
}

export function createRpcRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
