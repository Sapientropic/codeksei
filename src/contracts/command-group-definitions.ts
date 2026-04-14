import type { CommandGroupDefinition } from "./command-surface-definition-types";

export const COMMAND_GROUP_DEFINITIONS = [
  { id: "introspection", label: "发现与合同" },
  { id: "lifecycle", label: "启动与诊断" },
  { id: "workspace", label: "项目与线程" },
  { id: "approval", label: "授权与控制" },
  { id: "projects", label: "代码项目" },
  { id: "capabilities", label: "能力集成" },
] as const satisfies readonly CommandGroupDefinition[];
