// Registers cra-resolve-hook.mjs. Passed as `node --import ./register-hooks.mjs …`;
// resolution hooks run in their own thread and cannot be registered from the test file
// itself once its imports have already been resolved.
import { register } from 'node:module';

register('./cra-resolve-hook.mjs', import.meta.url);
