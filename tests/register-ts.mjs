// Registra el hook de resolución (resolve-ts-hooks.mjs) para los tests.
// Uso: node --import ./tests/register-ts.mjs --test "tests/*.test.ts"
import { register } from "node:module";
register("./resolve-ts-hooks.mjs", import.meta.url);
