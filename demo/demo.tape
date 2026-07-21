# Record with:  vhs demo/demo.tape   (run from the repo root; needs `npm run build` first)
#
# Setup (mock server, OLLAMA_HOST, alias, staging dir) runs inside Hide/Show so
# it is not recorded; the visible GIF shows only the offgrid-vision commands.
# The demo records a terminal only — no real model runs. demo/mock-ollama.mjs
# stands in for Ollama so output is instant and deterministic. Recording from a
# neutral /tmp staging dir keeps the shown path free of any real username.
Output demo/offgrid-vision.gif

Set Shell "bash"
Set FontSize 16
Set Width 1080
Set Height 840
Set Padding 24
Set TypingSpeed 55ms

Hide
Type 'export OGV_ROOT="$PWD"'
Enter
Type 'node "$OGV_ROOT/demo/mock-ollama.mjs" 2>/dev/null &'
Enter
Type 'export OLLAMA_HOST=http://localhost:11499'
Enter
Type 'alias offgrid-vision="node $OGV_ROOT/dist/cli.js"'
Enter
Type 'rm -rf /tmp/offgrid-vision-demo && mkdir -p /tmp/offgrid-vision-demo'
Enter
Type 'cp "$OGV_ROOT/demo/screenshot.png" /tmp/offgrid-vision-demo/'
Enter
Type 'cd /tmp/offgrid-vision-demo'
Enter
Sleep 1s
Type 'clear'
Enter
Show

Sleep 1s
Type "offgrid-vision doctor"
Enter
Sleep 3s

Type "offgrid-vision analyze screenshot.png"
Enter
Sleep 4s

Type "offgrid-vision analyze screenshot.png --json"
Enter
Sleep 5s

Hide
Type 'pkill -f mock-ollama.mjs; rm -rf /tmp/offgrid-vision-demo'
Enter
Show
