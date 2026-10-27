/** DomoTwin in ar (D-082), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./ar/chunks";
import { demo } from "./ar/demo";
import { main } from "./ar/main";

export const pack: Pack = { main, chunks, demo };
