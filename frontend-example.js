/**
 * Example helper for your existing Clarity Run Code button.
 * Replace API_BASE with the URL of the backend service you deploy on Render.
 */
const API_BASE = "https://YOUR-CLARITY-API.onrender.com";

export async function runCode(language, code, stdin = "") {
  const response = await fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code, stdin })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Execution failed (${response.status})`);
  }
  return data;
}

// Example:
// try {
//   const result = await runCode("python", 'print("Hello from Clarity")');
//   outputElement.textContent = result.output || result.stderr || "(No output)";
// } catch (error) {
//   outputElement.textContent = error.message;
// }
