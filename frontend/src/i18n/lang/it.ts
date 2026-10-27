/** DomoTwin in it (D-082), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./it/chunks";
import { demo } from "./it/demo";
import { main } from "./it/main";

export const pack: Pack = { main, chunks, demo };
