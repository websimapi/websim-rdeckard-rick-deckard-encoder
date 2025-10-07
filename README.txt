Quick notes:
- Open index.html in a browser (serve via simple static server for Worker to load).
- Encoding compresses optionally, then maps bits to "Rick"/"Deckard".
- Decoding parses header and recreates your original blob.
Security: do not auto-execute decoded binaries; treat them like downloaded files.

