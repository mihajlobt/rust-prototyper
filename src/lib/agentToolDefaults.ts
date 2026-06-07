const GENERIC_AGENT_TOOLS = ["web_fetch", "task_list", "skill", "tool_search", "lsp"];

export const WIZARD_TOOL_FILTER_DEFAULT = [
  "write_file", "edit_file", "read_file", "glob", "grep",
  "bash", "run_tsc", "run_lint", "run_build",
  "ask_user", "ask_user_form",
  "register_screen", "set_active_theme", "validate_design_json",
  ...GENERIC_AGENT_TOOLS,
];

export const SCREENS_TOOL_FILTER_DEFAULT = [
  "write_file", "edit_file", "read_file", "bash",
  "run_tsc", "run_lint", "run_build", "glob", "grep",
  "register_screen",
  ...GENERIC_AGENT_TOOLS,
];

export const COMPONENTS_TOOL_FILTER_DEFAULT = [
  "write_file", "edit_file", "read_file", "bash",
  "run_tsc", "run_lint", "run_build", "glob", "grep",
  ...GENERIC_AGENT_TOOLS,
];

export const DESIGN_TOOL_FILTER_DEFAULT = [
  "write_file", "edit_file", "read_file", "bash", "glob", "grep",
  "validate_design_json", "set_active_theme",
  ...GENERIC_AGENT_TOOLS,
];

export const PLANS_TOOL_FILTER_DEFAULT = [
  "read_file", "glob", "grep", "write_file", "edit_file",
  "ask_user", "ask_user_form",
  ...GENERIC_AGENT_TOOLS,
];
