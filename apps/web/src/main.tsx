import { TooltipProvider } from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { RuntimeProvider } from "./runtime/provider";
import { App } from "./ui/App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <RuntimeProvider>
        <TooltipProvider delayDuration={250}>
          <App />
        </TooltipProvider>
      </RuntimeProvider>
    </BrowserRouter>
  </StrictMode>,
);
