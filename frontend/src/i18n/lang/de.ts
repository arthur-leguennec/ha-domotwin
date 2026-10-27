/** DomoTwin in de (D-081), loaded when Home Assistant speaks it. */
import type { Pack } from "../pack";
import { chunks } from "./de/chunks";
import { demo } from "./de/demo";
import { main } from "./de/main";

export const pack: Pack = { main, chunks, demo };
