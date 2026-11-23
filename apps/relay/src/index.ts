import { createRelay } from "./server.js";

const relay = await createRelay();
const port = await relay.listen();
console.log(`Relay listening on 127.0.0.1:${port}`);
