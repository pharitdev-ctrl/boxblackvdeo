// Reloads the app's page, bypassing the cache (a new build's assets have new names).
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json()
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((ok) => (ws.onopen = ok))
ws.send(JSON.stringify({ id: 1, method: "Page.reload", params: { ignoreCache: true } }))
await new Promise((ok) => (ws.onmessage = ok))
ws.close()
