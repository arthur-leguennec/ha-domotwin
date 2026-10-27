/** DomoTwin in pt (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./pt/chunks";
import { main } from "./pt/main";

export const pack: Pack = { main, chunks };
