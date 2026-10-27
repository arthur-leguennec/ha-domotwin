/** DomoTwin in ko (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./ko/chunks";
import { main } from "./ko/main";

export const pack: Pack = { main, chunks };
