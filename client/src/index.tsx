import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import App from "./app";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
            <div className="max-w-xl rounded-lg border bg-card p-6">
              <h1 className="text-lg font-semibold">页面加载失败</h1>
              <p className="mt-2 text-sm text-muted-foreground">{String(error)}</p>
              <button className="mt-4 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={resetErrorBoundary}>重试</button>
            </div>
          </main>
        )}
      >
        <App />
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
