import { CARTESIAN_VIZ } from "./CartesianViz";
import { PART_VIZ } from "./PartViz";
import { TILE_VIZ } from "./TileViz";
import { MATRIX_VIZ } from "./MatrixViz";
import { DIAGRAM_VIZ } from "./DiagramViz";
import { TABLE_VIZ } from "./TableViz";
import { CONTENT_VIZ } from "./ContentViz";
import { VIZ_CATEGORIES, type VizCategory, type VizDef } from "./def";

/** Every visualisation the Studio offers. To add one: write a VizDef and include its array here. */
export const VIZ: VizDef[] = [...TILE_VIZ, ...CARTESIAN_VIZ, ...PART_VIZ, ...MATRIX_VIZ, ...DIAGRAM_VIZ, ...TABLE_VIZ, ...CONTENT_VIZ];
const BY_TYPE = new Map(VIZ.map((v) => [v.type, v]));
export const vizOf = (type: string): VizDef | undefined => BY_TYPE.get(type);
export const vizByCategory = (): Array<{ category: VizCategory; items: VizDef[] }> =>
  VIZ_CATEGORIES.map((category) => ({ category, items: VIZ.filter((v) => v.category === category) })).filter((g) => g.items.length);
/** Trend charts start on the time field; everything else on a plain dimension. */
export const prefersTime = (v: VizDef): boolean => v.category === "Trend" || v.type === "calendar_heatmap";
