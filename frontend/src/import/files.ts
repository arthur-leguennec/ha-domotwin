/**
 * Which files the plan import reads (D-040, D-057): by their names, else by what their JSON
 * holds. The others are read as DomoTwin plans. Kept apart from the import module, which is
 * fetched only once such a file is picked.
 */

/** The plans of other apps, by their files' names (a glTF or an FBX to say what to do instead). */
export const IMPORTED_FILES =
  /\.(ifc|sh3d|dxf|usdz|usda|usdc|fml|obj|ply|glb|gltf|stl|fbx|gz|png)$/i;

/** What the plan picker offers. */
export const PLAN_FILES =
  ".json,application/json,.ifc,.sh3d,.dxf,.usdz,.usda,.usdc,.fml,.obj,.ply,.glb,.gltf,.stl,.gz,.png";

/**
 * Whether a JSON file's content is a plan of another app rather than a DomoTwin plan: a room
 * scan (RoomPlan's `CapturedRoom` or `CapturedStructure`), a robot's map (Valetudo's), a
 * Floorplanner project (FML), a glTF.
 */
export function isOtherAppJson(read: unknown): boolean {
  if (typeof read !== "object" || read === null || Array.isArray(read)) return false;
  const fields = read as Record<string, unknown>;
  if (fields.format === "domotwin-plan") return false;
  const project =
    typeof fields.project === "object" && fields.project !== null
      ? (fields.project as Record<string, unknown>)
      : fields;
  return (
    "walls" in fields ||
    "rooms" in fields ||
    fields.__class === "ValetudoMap" ||
    ("layers" in fields && typeof fields.pixelSize === "number") ||
    Array.isArray(project.floors) ||
    ("asset" in fields && "meshes" in fields)
  );
}
