export const projectKeys = {
  all: (project: string) => ["project", project] as const,
  components: (project: string) => ["project", project, "components"] as const,
  component: (project: string, name: string) =>
    ["project", project, "component", name] as const,
  componentCode: (project: string, name: string) =>
    ["project", project, "component", name, "code"] as const,
  screens: (project: string) => ["project", project, "screens"] as const,
  screen: (project: string, name: string) =>
    ["project", project, "screen", name] as const,
  themes: (project: string) => ["project", project, "themes"] as const,
  theme: (project: string, name: string) =>
    ["project", project, "theme", name] as const,
  themeCss: (project: string, name: string) =>
    ["project", project, "theme", name, "css"] as const,
  workflows: (project: string) => ["project", project, "workflows"] as const,
  tree: (project: string, section: string) =>
    ["project", project, "tree", section] as const,
};
