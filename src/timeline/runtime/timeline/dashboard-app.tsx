import "./css/dashboard.css";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

import { createRoot } from "react-dom/client";

import { DashboardApp } from "./components/DashboardApp";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("timeline dashboard root element not found");
}

createRoot(rootElement).render(<DashboardApp />);
