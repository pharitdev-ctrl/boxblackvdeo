import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/shell.css"
import "./styles/screens.css"
import "./styles/edit.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={window.boxblack} />
  </StrictMode>,
)
