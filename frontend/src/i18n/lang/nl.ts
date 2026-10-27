/** DomoTwin in nl (D-082), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./nl/chunks";
import { demo } from "./nl/demo";
import { main } from "./nl/main";

export const pack: Pack = { main, chunks, demo };
