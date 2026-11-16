/** Colours shared by the 3D overlays (three.js takes numbers) and the 2D viewers (CSS takes strings), so they always match. */
export const STEREO = { left: 0xc77dff, right: 0x2dd4bf } as const; // violet = left image, teal = right image
export const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
