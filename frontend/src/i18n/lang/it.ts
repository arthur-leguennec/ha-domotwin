/** DomoTwin in it (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./it/chunks";
import { main } from "./it/main";

export const pack: Pack = { main, chunks };
