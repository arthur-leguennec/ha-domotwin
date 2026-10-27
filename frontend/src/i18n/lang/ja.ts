/** DomoTwin in ja (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./ja/chunks";
import { demo } from "./ja/demo";
import { main } from "./ja/main";

export const pack: Pack = { main, chunks, demo };
