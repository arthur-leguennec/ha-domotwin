/** DomoTwin in pt (D-082), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./pt/chunks";
import { demo } from "./pt/demo";
import { main } from "./pt/main";

export const pack: Pack = { main, chunks, demo };
