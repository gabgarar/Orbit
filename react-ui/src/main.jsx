import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// The legacy Cesium runtime is loaded after React has mounted.  Initialise the
// gate synchronously so a queued/synthetic project command cannot race the
// first identity render.  The session itself is populated by App only after a
// successful local or provider-backed unlock.
if (typeof window !== "undefined") {
    window.__orbitIdentityAccessRequired = true;
    window.__orbitIdentitySession = null;
}

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App />
    </StrictMode>
);
