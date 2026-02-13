/**
 * Node.js PermissionHandler implementation.
 * Provides auto-allow for all tools (suitable for prototyping).
 */

import type {
  PermissionHandler,
  PermissionRequest,
  PermissionResponse,
  PermissionDecision,
  ToolPermissionRules,
} from '@anthropic/zed-agent-core';

export interface NodePermissionHandlerOptions {
  /** If true, auto-allow all tool calls (default: true). */
  autoAllow?: boolean;
  /** Custom permission callback. */
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;
}

export class NodePermissionHandler implements PermissionHandler {
  private autoAllow: boolean;
  private callback?: (request: PermissionRequest) => Promise<PermissionResponse>;

  constructor(options: NodePermissionHandlerOptions = {}) {
    this.autoAllow = options.autoAllow ?? true;
    this.callback = options.onPermissionRequest;
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    if (this.callback) {
      return this.callback(request);
    }
    if (this.autoAllow) {
      return { type: 'approved', optionId: 'allow' };
    }
    return { type: 'denied', optionId: 'deny' };
  }

  checkAutoPermission(_toolName: string, _inputs: string[]): PermissionDecision {
    if (this.autoAllow) {
      return { type: 'allow' };
    }
    return { type: 'confirm' };
  }

  getToolPermissionRules(): ToolPermissionRules {
    return {
      mode: this.autoAllow ? 'auto' : 'always_ask',
    };
  }
}
