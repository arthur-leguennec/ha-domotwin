/** DomoTwin in ar (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./ar/chunks";
import { main } from "./ar/main";

export const pack: Pack = { main, chunks };
