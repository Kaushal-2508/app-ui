// The ONLY dynamic-import target of the banner layer: three + the engine in one lazy chunk.
// Its file name names the chunk (assets/bannerEngine.<hash>.js), which Banner3DLayer
// matches to keep a failed download of it away from the global reload handler.
export { createSchoolScene } from "./scene";
export { todFromClock, clockParts, TODS } from "./palettes";
export { STILL_T } from "./figures";
export type * from "./types";
