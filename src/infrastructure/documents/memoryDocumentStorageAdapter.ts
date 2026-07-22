import { MarkdownDocumentStorageAdapter } from "./markdownDocumentStorageAdapter";
import {
  MemoryWorkspaceFilePort,
  type MemoryWorkspaceFilePortOptions
} from "./memoryWorkspaceFilePort";

export interface MemoryDocumentStorageAdapterOptions extends MemoryWorkspaceFilePortOptions {
  readonly workspaceId?: string;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

/** Complete shared-folder adapter backed only by memory for deterministic tests. */
export class MemoryDocumentStorageAdapter extends MarkdownDocumentStorageAdapter {
  readonly memory: MemoryWorkspaceFilePort;

  constructor(options: MemoryDocumentStorageAdapterOptions = {}) {
    const memory = new MemoryWorkspaceFilePort(options);
    super({
      workspaceId: options.workspaceId ?? "memory-workspace",
      filePort: memory,
      createId: options.createId,
      now: options.now
    });
    this.memory = memory;
  }
}
