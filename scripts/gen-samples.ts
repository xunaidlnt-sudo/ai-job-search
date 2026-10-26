// Regenerate samples/demo.xer from the built-in demo (npm run samples).
import { writeFileSync } from "node:fs";
import { demoXer } from "../src/core/demo";
writeFileSync(new URL("../samples/demo.xer", import.meta.url), demoXer());
console.log("samples/demo.xer written");
