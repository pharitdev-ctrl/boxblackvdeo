import react from "@vitejs/plugin-react"
export default { root: import.meta.dirname, plugins: [react()], server: { port: 5179, fs: { allow: [import.meta.dirname + "/.."] } }, build: { target: "esnext" }, esbuild: { target: "esnext" }, optimizeDeps: { esbuildOptions: { target: "esnext" } } }
