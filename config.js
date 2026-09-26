// Where the backend lives. Local development uses the uvicorn server on port 8000;
// the published page uses the Render service. Replace the Render URL after deploying.
// For development, localStorage.apiBase can point the page at another local server.
window.API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? (() => { try { return JSON.parse(localStorage.getItem("apiBase")) || "http://localhost:8000"; } catch { return "http://localhost:8000"; } })()
  : "https://ignatius-hw4-api.onrender.com";
