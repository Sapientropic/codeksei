import type { CommandActionDefinition } from "./command-surface-definition-types";

export const APPROVAL_COMMAND_ACTION_DEFINITIONS = [
  {
    action: "approval.accept_once",
    groupId: "approval",
    summary: "允许当前待处理的授权请求一次",
    terminal: [],
    weixin: ["/yes"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "approval.accept_workspace",
    groupId: "approval",
    summary: "在当前项目内持续允许同前缀命令",
    terminal: [],
    weixin: ["/always"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "approval.reject_once",
    groupId: "approval",
    summary: "拒绝当前待处理的授权请求",
    terminal: [],
    weixin: ["/no"],
    status: "active",
    entrypointType: "weixin",
  },
] as const satisfies readonly CommandActionDefinition[];
