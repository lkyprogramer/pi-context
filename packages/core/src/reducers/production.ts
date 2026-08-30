import { bashReducer } from "./bash.js";
import { buildLogReducer } from "./build-log.js";
import { fileMutationReducer } from "./file-mutation.js";
import { pointerReducer } from "./pointer.js";
import { readReducer } from "./read.js";
import { searchReducer } from "./search.js";
import { testLogReducer } from "./test-log.js";
import type { Reducer } from "./types.js";

export function createProductionReducers(): Reducer[] {
  return [
    bashReducer,
    testLogReducer,
    buildLogReducer,
    readReducer,
    searchReducer,
    fileMutationReducer,
    pointerReducer,
  ];
}
