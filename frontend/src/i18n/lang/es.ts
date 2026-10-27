/** DomoTwin in es (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./es/chunks";
import { demo } from "./es/demo";
import { main } from "./es/main";

export const pack: Pack = { main, chunks, demo };
