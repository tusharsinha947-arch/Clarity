import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";

let pyodide = null;
let loadError = "";
const pyodideReady = loadPyodide().then(runtime => {
  pyodide = runtime;
  self.postMessage({ type: "ready" });
}).catch(error => {
  loadError = String(error?.message || error);
  self.postMessage({ type: "load-error", error: loadError });
});

self.addEventListener("message", async event => {
  const { id, code, stdin = "" } = event.data || {};
  let stdout = "";
  let stderr = "";
  try {
    await pyodideReady;
    if (!pyodide) throw new Error(loadError || "Python could not start.");

    pyodide.setStdout({ batched: text => { stdout += text; } });
    pyodide.setStderr({ batched: text => { stderr += text; } });

    const lines = String(stdin).length ? String(stdin).split(/\r?\n/) : [];
    let nextLine = 0;
    pyodide.setStdin({
      stdin: () => nextLine < lines.length ? `${lines[nextLine++]}\n` : null,
      autoEOF: false
    });

    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
    self.postMessage({ type: "result", id, ok: true, stdout, stderr });
  } catch (error) {
    self.postMessage({
      type: "result",
      id,
      ok: false,
      stdout,
      stderr,
      error: String(error?.message || error)
    });
  }
});
