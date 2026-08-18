// Node module-resolution hook, so a plain `node` process can import the app's own
// source files out of ../src and run them unmodified.
//
// Two things stand in the way, both artefacts of the app being a Create React App
// bundle rather than a node package:
//
//  1. `import { db } from './clubPaths'` — webpack fills in the `.js`; node's ESM
//     resolver does not, and throws ERR_MODULE_NOT_FOUND. So a failed relative
//     resolution is retried with `.js` appended.
//  2. `firebase` — the repo root has v9 (what the app ships), this directory has v12
//     (what @firebase/rules-unit-testing needs). Resolved from ../src, `firebase/
//     firestore` would give v9, and a v12 Firestore instance passed into v9's `doc()`
//     is rejected as a foreign object. Every `firebase*` specifier is therefore
//     resolved as if imported from THIS directory, so the source under test and the
//     test itself share one copy. The modular API used by the migration (doc,
//     collection, getDoc(s), setDoc, updateDoc, writeBatch, serverTimestamp) is
//     unchanged between the two.
//
// This is a test-harness concern only — nothing in it affects the app build.
const HERE = new URL('./cra-resolve-hook.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'firebase' || specifier.startsWith('firebase/')) {
    return nextResolve(specifier, { ...context, parentURL: HERE });
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
