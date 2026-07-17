export type GtdSection = "inbox" | "tasks" | "projects" | "calendar" | "review";
export type SystemTool =
  | "workspace"
  | "sphere-manager"
  | "reflections"
  | "insights"
  | "integrations"
  | "settings";

export type AppRoute =
  | { kind: "home" }
  | { kind: "gtd"; section: GtdSection }
  | { kind: "sphere"; sphereId: string }
  | { kind: "tool"; tool: SystemTool }
  | { kind: "object"; objectId: string };

export interface NavigationCrumb {
  label: string;
  href: string;
}

export interface NavigateOptions {
  label?: string;
  preserveTrail?: boolean;
  trail?: NavigationCrumb[];
}

