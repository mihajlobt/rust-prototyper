import { create } from "zustand";

interface UIState {
  // Screens
  screensDevice: "desktop" | "tablet" | "mobile";
  screensShowInspector: boolean;
  screensLinkMode: boolean;
  screensZoom: number;

  // Components
  componentsDevice: "desktop" | "tablet" | "mobile";
  componentsDarkPreview: boolean;
  componentsShowInspector: boolean;
  componentsCodeOpen: boolean;

  // Themes
  themesDevice: "desktop" | "tablet" | "mobile";
  themesDarkPreview: boolean;
  themesShowInspector: boolean;
  themesCodeOpen: boolean;
  themesFramework: "shadcn" | "daisy" | "bootstrap" | "generic";
  themesDarkLightSupport: boolean;

  // APIs
  apisShowInspector: boolean;

  // Workflows
  workflowsShowPanel: boolean;
}

export const useUIStore = create<UIState>()(() => ({
  // Screens
  screensDevice: "desktop",
  screensShowInspector: false,
  screensLinkMode: false,
  screensZoom: 1,

  // Components
  componentsDevice: "desktop",
  componentsDarkPreview: false,
  componentsShowInspector: false,
  componentsCodeOpen: true,

  // Themes
  themesDevice: "desktop",
  themesDarkPreview: false,
  themesShowInspector: false,
  themesCodeOpen: true,
  themesFramework: "generic",
  themesDarkLightSupport: true,

  // APIs
  apisShowInspector: false,

  // Workflows
  workflowsShowPanel: false,
}));