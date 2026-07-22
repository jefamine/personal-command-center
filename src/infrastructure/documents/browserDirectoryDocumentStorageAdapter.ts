import {
  BrowserDirectoryFilePort,
  type BrowserDirectoryHandleLike
} from "./browserDirectoryFilePort";
import { MarkdownDocumentStorageAdapter } from "./markdownDocumentStorageAdapter";

export interface BrowserDirectoryDocumentStorageAdapterOptions {
  readonly workspaceId: string;
  readonly directoryHandle: BrowserDirectoryHandleLike;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

/** Browser implementation; all policy and safety remain in the shared engine. */
export class BrowserDirectoryDocumentStorageAdapter extends MarkdownDocumentStorageAdapter {
  readonly directoryHandle: BrowserDirectoryHandleLike;

  constructor(options: BrowserDirectoryDocumentStorageAdapterOptions) {
    super({
      workspaceId: options.workspaceId,
      filePort: new BrowserDirectoryFilePort(options.directoryHandle),
      createId: options.createId,
      now: options.now
    });
    this.directoryHandle = options.directoryHandle;
  }
}
